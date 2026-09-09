import { Braces, CarFront } from 'lucide-vue-next';

export const portals = [
  {
    id: 'showroom',
    name: '环境中心',
    description: '管理开发场景、工具链、方案检查与脚本导出。',
    route: '/portals',
    icon: CarFront,
    available: true,
  },
  {
    id: 'environment',
    name: '开发环境',
    description: '规划技术栈、检查兼容性，并导出可审阅的安装脚本。',
    route: '/environment',
    icon: Braces,
    available: true,
  },
] as const;
