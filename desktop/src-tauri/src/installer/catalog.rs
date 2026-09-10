use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub tool_id: String,
    pub version_id: String,
    pub reason: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub platform: String,
    pub architecture: String,
    pub selections: Vec<Selection>,
    pub catalog_revision: String,
    pub fingerprint: String,
    #[serde(default)]
    pub installation_targets: HashMap<String, String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub revision: String,
    pub tools: Vec<Tool>,
    pub dependencies: Vec<Dependency>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub disk_mb: u64,
    pub homepage: String,
    pub versions: Vec<Version>,
    pub recipes: Vec<Recipe>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: String,
    pub version: String,
    pub accepted_range: String,
    #[serde(default)]
    pub recommended: bool,
    pub managed_by_tool_id: Option<String>,
    #[serde(default)]
    pub bundled_tools: Vec<Bundle>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub tool_id: String,
    pub version: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub version_id: String,
    pub platform: String,
    pub architecture: String,
    pub manager: String,
    pub package_id: String,
    pub arguments: Option<Vec<String>>,
    pub verify: Process,
    pub approved: bool,
    pub installation_location: Option<InstallationLocation>,
}
#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InstallationLocation {
    Directory { executable: String },
    Fixed,
}
#[derive(Clone, Deserialize)]
pub struct Process {
    pub executable: String,
    pub args: Vec<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub source_tool_id: String,
    pub target_tool_id: String,
    pub kind: String,
    pub target_range: Option<String>,
}
#[derive(Clone)]
pub struct Resolved {
    pub tool: Tool,
    pub version: Version,
    pub recipe: Option<Recipe>,
    pub target_disk: Option<String>,
}

pub fn embedded() -> Catalog {
    let signed: serde_json::Value = serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/native-catalog.signed.json"))).expect("Invalid recipe envelope");
    let key: [u8; 32] = STANDARD.decode(include_str!(concat!(env!("OUT_DIR"), "/native-catalog.public-key")).trim()).expect("Invalid recipe key").try_into().expect("Invalid key length");
    let payload = STANDARD.decode(signed["payload"].as_str().expect("Missing payload")).expect("Invalid payload");
    let signature = Signature::from_slice(&STANDARD.decode(signed["signature"].as_str().expect("Missing signature")).expect("Invalid signature")).expect("Invalid signature length");
    VerifyingKey::from_bytes(&key).expect("Invalid recipe key").verify_strict(&payload, &signature).expect("Native recipe signature failed");
    assert_eq!(payload.as_slice(), include_bytes!(concat!(env!("OUT_DIR"), "/catalog.json")), "Reviewed recipes changed; sign and review the new catalog");
    serde_json::from_slice(&payload).expect("invalid embedded catalog")
}

pub fn resolve(request: &Request) -> Result<Vec<Resolved>, String> {
    let catalog = embedded();
    if request.catalog_revision != catalog.revision {
        return Err("目录版本与桌面执行器不一致，请更新桌面端或导出脚本。".into());
    }
    if !["windows", "macos", "linux"].contains(&request.platform.as_str())
        || !["x64", "arm64"].contains(&request.architecture.as_str())
    {
        return Err("无效的系统或架构。".into());
    }
    if request.selections.is_empty() || request.selections.len() > catalog.tools.len() {
        return Err("请选择有效工具。".into());
    }
    let mut selected = HashMap::new();
    for selection in &request.selections {
        let tool = catalog
            .tools
            .iter()
            .find(|t| t.id == selection.tool_id)
            .ok_or("未知工具")?;
        if !tool.versions.iter().any(|v| v.id == selection.version_id)
            || selected
                .insert(selection.tool_id.clone(), selection.version_id.clone())
                .is_some()
        {
            return Err("工具版本无效或重复。".into());
        }
    }
    let mut result = Vec::new();
    let mut visited = HashSet::new();
    let mut active = HashSet::new();
    for item in &request.selections {
        visit(
            &item.tool_id,
            &catalog,
            request,
            &mut selected,
            &mut visited,
            &mut active,
            &mut result,
        )?;
    }
    for dependency in catalog.dependencies.iter().filter(|d| d.kind == "requires") {
        if result
            .iter()
            .any(|r| r.tool.id == dependency.source_tool_id)
        {
            if let Some(range) = &dependency.target_range {
                let target = result
                    .iter()
                    .find(|r| r.tool.id == dependency.target_tool_id)
                    .ok_or("缺少必要依赖")?;
                if !satisfies(&target.version.version, &range.replace(' ', ", ")) {
                    return Err(format!("{} 版本不满足依赖 {}", target.tool.name, range));
                }
            }
        }
    }
    let mut ordered = Vec::new();
    for item in result.iter().filter(|item| item.tool.id != "npm") {
        ordered.push(item.clone());
        for bundled in &item.version.bundled_tools {
            let tool = catalog
                .tools
                .iter()
                .find(|t| t.id == bundled.tool_id)
                .ok_or("缺少随运行时提供的工具")?;
            let version = tool
                .versions
                .iter()
                .find(|v| v.version == bundled.version)
                .ok_or("缺少随运行时提供的版本")?;
            if request
                .selections
                .iter()
                .any(|s| s.tool_id == tool.id && s.version_id != version.id)
            {
                return Err(format!(
                    "{} 必须与 {} 提供的版本一致",
                    tool.name, item.tool.name
                ));
            }
            ordered.push(Resolved {
                tool: tool.clone(),
                version: version.clone(),
                recipe: None,
                target_disk: None,
            });
        }
    }
    super::locations::assign(request, &mut ordered)?;
    Ok(ordered)
}

fn visit(
    id: &str,
    catalog: &Catalog,
    request: &Request,
    selected: &mut HashMap<String, String>,
    visited: &mut HashSet<String>,
    active: &mut HashSet<String>,
    result: &mut Vec<Resolved>,
) -> Result<(), String> {
    if visited.contains(id) {
        return Ok(());
    }
    if !active.insert(id.into()) {
        return Err("工具依赖存在循环。".into());
    }
    let tool = catalog
        .tools
        .iter()
        .find(|t| t.id == id)
        .ok_or("未知依赖")?;
    let version = if let Some(version_id) = selected.get(id) {
        tool.versions.iter().find(|v| &v.id == version_id)
    } else {
        tool.versions
            .iter()
            .find(|v| v.recommended)
            .or(tool.versions.first())
    }
    .ok_or("缺少工具版本")?
    .clone();
    selected.insert(id.into(), version.id.clone());
    let mut dependencies: Vec<String> = catalog
        .dependencies
        .iter()
        .filter(|d| d.source_tool_id == id && d.kind == "requires")
        .map(|d| d.target_tool_id.clone())
        .collect();
    if let Some(manager) = &version.managed_by_tool_id {
        if !dependencies.contains(manager) {
            dependencies.push(manager.clone());
        }
    }
    if id == "npm" {
        dependencies.push("node".into());
    }
    for dependency in dependencies {
        visit(
            &dependency,
            catalog,
            request,
            selected,
            visited,
            active,
            result,
        )?;
    }
    let recipe = tool
        .recipes
        .iter()
        .find(|r| {
            r.approved
                && r.version_id == version.id
                && r.platform == request.platform
                && (r.architecture == "any" || r.architecture == request.architecture)
        })
        .cloned();
    if recipe.is_none() && id != "npm" {
        return Err(format!("{} 暂无适用于当前目标的安装方式。", tool.name));
    }
    active.remove(id);
    visited.insert(id.into());
    result.push(Resolved {
        tool: tool.clone(),
        version,
        recipe,
        target_disk: None,
    });
    Ok(())
}

pub fn parse_version(output: &str) -> Option<semver::Version> {
    output
        .split(|c: char| !c.is_ascii_digit() && c != '.')
        .filter(|s| s.contains('.'))
        .find_map(|token| {
            let token = token.trim_matches('.');
            let mut parts: Vec<&str> = token.split('.').collect();
            if parts.len() > 3 {
                parts.truncate(3);
            }
            while parts.len() < 3 {
                parts.push("0");
            }
            semver::Version::parse(&parts.join(".")).ok()
        })
}
pub fn satisfies(version: &str, range: &str) -> bool {
    let version = parse_version(version).or_else(|| {
        version
            .parse::<u64>()
            .ok()
            .map(|major| semver::Version::new(major, 0, 0))
    });
    version
        .and_then(|v| semver::VersionReq::parse(range).ok().map(|r| r.matches(&v)))
        .unwrap_or(false)
}

pub fn apt_version(version: &str) -> &str {
    version
        .rsplit(':')
        .next()
        .unwrap_or(version)
        .split(['+', '-', '~'])
        .next()
        .unwrap_or(version)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_distribution_package_versions() {
        assert!(satisfies(
            apt_version("1:16+257build1"),
            ">=14.0.0, <19.0.0"
        ));
        assert!(satisfies(apt_version("3.12.3-0ubuntu2"), ">=3.8.0, <4.0.0"));
    }
    fn request() -> Request {
        Request {
            platform: "windows".into(),
            architecture: "x64".into(),
            selections: vec![Selection {
                tool_id: "pnpm".into(),
                version_id: "pnpm-10.34.5".into(),
                reason: None,
            }],
            catalog_revision: embedded().revision,
            fingerprint: "test".into(),
            installation_targets: HashMap::new(),
        }
    }
    #[test]
    fn resolves_trusted_dependencies_in_order() {
        let items = resolve(&request()).unwrap();
        assert_eq!(
            items.iter().map(|r| r.tool.id.as_str()).collect::<Vec<_>>(),
            vec!["volta", "node", "npm", "pnpm"]
        );
    }
    #[test]
    fn rejects_a_mismatched_bundled_npm() {
        let mut r = request();
        r.selections.push(Selection {
            tool_id: "npm".into(),
            version_id: "npm-10".into(),
            reason: None,
        });
        assert!(resolve(&r).is_err());
    }
    #[test]
    fn rejects_unknown_and_remote_recipes() {
        let mut r = request();
        r.selections[0].tool_id = "powershell".into();
        assert!(resolve(&r).is_err());
        r = request();
        r.catalog_revision = "remote".into();
        assert!(resolve(&r).is_err());
    }
    #[test]
    fn accepts_only_compatible_versions() {
        assert!(satisfies("v24.21.0", ">=24.20.0, <25.0.0"));
        assert!(!satisfies("26.0.0", ">=24.20.0, <25.0.0"));
        assert!(satisfies("openjdk version \"21.0.9\"", ">=21.0.0, <22.0.0"));
        assert!(!satisfies("unknown", "*"));
    }
    #[test]
    fn frontend_cannot_supply_executables() {
        assert!(serde_json::from_str::<Request>(r#"{"platform":"windows","architecture":"x64","selections":[],"catalogRevision":"x","fingerprint":"x","executable":"cmd"}"#).is_err());
    }
}
