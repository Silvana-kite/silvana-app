use super::{
    catalog::{self, Resolved},
    Session,
};
use std::sync::atomic::{AtomicBool, Ordering};

pub trait Backend {
    fn install(&mut self, item: &Resolved, log: &mut dyn FnMut(String)) -> Result<(), String>;
    fn verify(&mut self, item: &Resolved) -> Result<(String, Option<String>), String>;
}

pub fn run(
    session: &mut Session,
    items: &[Resolved],
    cancel: &AtomicBool,
    backend: &mut impl Backend,
    publish: &mut impl FnMut(&Session) -> Result<(), String>,
) -> Result<(), String> {
    for (index, item) in items.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            session.status = "cancelled".into();
            return publish(session);
        }
        if session.steps[index].status == "skipped" {
            if let Ok((version, path)) = backend.verify(item) {
                if let Err(error) = super::locations::verify_path(item, path.as_deref()) {
                    session.steps[index].status = "failed".into();
                    session.steps[index].message = error;
                    session.status = "failed".into();
                    return publish(session);
                }
                if catalog::satisfies(&version, &item.version.accepted_range) {
                    session.steps[index].installed_version = Some(version);
                    session.steps[index].executable_path = path;
                    publish(session)?;
                    continue;
                }
            }
            session.steps[index].status = "pending".into();
        }
        session.steps[index].status = "running".into();
        publish(session)?;
        let installed = backend.install(item, &mut |line| {
            if !line.is_empty() {
                session.logs.push(
                    line.chars()
                        .filter(|c| !c.is_control() || *c == '\t')
                        .take(4096)
                        .collect(),
                );
                if session.logs.len() > 300 {
                    session.logs.remove(0);
                }
                if cancel.load(Ordering::SeqCst) {
                    session.status = "cancelling".into();
                }
                let _ = publish(session);
            }
        });
        let verified = installed
            .and_then(|()| backend.verify(item))
            .and_then(|(version, path)| {
                session.steps[index].installed_version = Some(version.clone());
                let location = super::locations::verify_path(item, path.as_deref());
                session.steps[index].executable_path = path;
                location?;
                if catalog::satisfies(&version, &item.version.accepted_range) {
                    Ok(())
                } else {
                    Err(format!(
                        "安装后的版本 {version} 不满足 {}",
                        item.version.accepted_range
                    ))
                }
            });
        match verified {
            Ok(()) => {
                session.steps[index].status = "success".into();
                session.steps[index].message = "安装与版本验证通过".into();
            }
            Err(error) => {
                session.steps[index].status = "failed".into();
                session.steps[index].message = error;
                session.status = "failed".into();
                return publish(session);
            }
        }
        publish(session)?;
    }
    session.status = if cancel.load(Ordering::SeqCst) {
        "cancelled"
    } else {
        "success"
    }
    .into();
    publish(session)
}

#[cfg(test)]
mod tests {
    use super::super::{
        catalog::{Request, Selection},
        Step,
    };
    use super::*;
    struct Fake<'a> {
        calls: Vec<String>,
        fail: bool,
        version: String,
        cancel: Option<&'a AtomicBool>,
    }
    impl Backend for Fake<'_> {
        fn install(&mut self, item: &Resolved, log: &mut dyn FnMut(String)) -> Result<(), String> {
            self.calls.push(item.tool.id.clone());
            log("package output".into());
            if let Some(cancel) = self.cancel {
                cancel.store(true, Ordering::SeqCst);
            }
            if self.fail {
                Err("denied or network unavailable".into())
            } else {
                Ok(())
            }
        }
        fn verify(&mut self, _: &Resolved) -> Result<(String, Option<String>), String> {
            Ok((self.version.clone(), Some("/verified/tool".into())))
        }
    }
    fn fixture() -> (Session, Vec<Resolved>) {
        let request = Request {
            platform: "windows".into(),
            architecture: "x64".into(),
            selections: vec![
                Selection {
                    tool_id: "git".into(),
                    version_id: "git-stable".into(),
                    reason: None,
                },
                Selection {
                    tool_id: "vscode".into(),
                    version_id: "vscode-stable".into(),
                    reason: None,
                },
            ],
            catalog_revision: catalog::embedded().revision,
            fingerprint: "fixture".into(),
            installation_targets: Default::default(),
        };
        let items = catalog::resolve(&request).unwrap();
        let session = Session {
            sequence: 0,
            id: "fixture".into(),
            status: "running".into(),
            steps: items
                .iter()
                .map(|i| Step {
                    tool_id: i.tool.id.clone(),
                    name: i.tool.name.clone(),
                    version: i.version.version.clone(),
                    installed_version: None,
                    executable_path: None,
                    target_disk: None,
                    install_directory: None,
                    status: "pending".into(),
                    message: String::new(),
                })
                .collect(),
            blockers: vec![],
            logs: vec![],
            fingerprint: "fixture".into(),
            request: Some(request),
        };
        (session, items)
    }
    #[test]
    fn a_successful_process_or_skipped_version_cannot_bypass_the_target_disk() {
        struct WrongDisk {
            installs: usize,
        }
        impl Backend for WrongDisk {
            fn install(&mut self, _: &Resolved, _: &mut dyn FnMut(String)) -> Result<(), String> {
                self.installs += 1;
                Ok(())
            }
            fn verify(&mut self, _: &Resolved) -> Result<(String, Option<String>), String> {
                Ok((
                    "2.50.0".into(),
                    Some(
                        std::env::current_exe()
                            .unwrap()
                            .to_string_lossy()
                            .into_owned(),
                    ),
                ))
            }
        }
        for skipped in [false, true] {
            let (mut session, mut items) = fixture();
            let actual = std::env::current_exe().unwrap();
            items[0].target_disk = Some(
                if super::super::locations::on_disk(&actual, "Z:\\") {
                    "Y:\\"
                } else {
                    "Z:\\"
                }
                .into(),
            );
            if skipped {
                session.steps[0].status = "skipped".into();
            }
            let mut backend = WrongDisk { installs: 0 };
            run(
                &mut session,
                &items,
                &AtomicBool::new(false),
                &mut backend,
                &mut |_| Ok(()),
            )
            .unwrap();
            assert_eq!(session.status, "failed");
            assert_eq!(session.steps[1].status, "pending");
            assert_eq!(backend.installs, usize::from(!skipped));
        }
    }
    #[test]
    fn failure_stops_dependents_and_retains_reason() {
        let (mut session, items) = fixture();
        let mut backend = Fake {
            calls: vec![],
            fail: true,
            version: "1.0.0".into(),
            cancel: None,
        };
        run(
            &mut session,
            &items,
            &AtomicBool::new(false),
            &mut backend,
            &mut |_| Ok(()),
        )
        .unwrap();
        assert_eq!(backend.calls, vec!["git"]);
        assert_eq!(session.status, "failed");
        assert_eq!(session.steps[1].status, "pending");
        assert!(session.steps[0].message.contains("denied"));
    }
    #[test]
    fn cancellation_finishes_current_transaction_before_stopping() {
        let (mut session, items) = fixture();
        let cancel = AtomicBool::new(false);
        let mut backend = Fake {
            calls: vec![],
            fail: false,
            version: "1.0.0".into(),
            cancel: Some(&cancel),
        };
        run(&mut session, &items, &cancel, &mut backend, &mut |_| Ok(())).unwrap();
        assert_eq!(session.status, "cancelled");
        assert_eq!(session.steps[0].status, "success");
        assert_eq!(backend.calls, vec!["git"]);
    }
    #[test]
    fn retry_skips_tools_satisfied_by_preflight() {
        let (mut session, items) = fixture();
        session.steps[0].status = "skipped".into();
        let mut backend = Fake {
            calls: vec![],
            fail: false,
            version: "1.0.0".into(),
            cancel: None,
        };
        run(
            &mut session,
            &items,
            &AtomicBool::new(false),
            &mut backend,
            &mut |_| Ok(()),
        )
        .unwrap();
        assert_eq!(session.status, "success");
        assert_eq!(backend.calls, vec!["vscode"]);
        assert_eq!(
            session.steps[1].executable_path.as_deref(),
            Some("/verified/tool")
        );
    }
    #[test]
    fn exit_success_without_a_matching_version_is_failure() {
        let (mut session, mut items) = fixture();
        items[0].version.accepted_range = ">=2.0.0".into();
        let mut backend = Fake {
            calls: vec![],
            fail: false,
            version: "1.0.0".into(),
            cancel: None,
        };
        run(
            &mut session,
            &items,
            &AtomicBool::new(false),
            &mut backend,
            &mut |_| Ok(()),
        )
        .unwrap();
        assert_eq!(session.status, "failed");
        assert_eq!(backend.calls.len(), 1);
    }
    #[test]
    fn storage_failure_prevents_starting_a_package() {
        let (mut session, items) = fixture();
        let mut backend = Fake {
            calls: vec![],
            fail: false,
            version: "1.0.0".into(),
            cancel: None,
        };
        assert!(run(
            &mut session,
            &items,
            &AtomicBool::new(false),
            &mut backend,
            &mut |_| Err("disk full".into())
        )
        .is_err());
        assert!(backend.calls.is_empty());
    }
}
