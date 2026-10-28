import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Library,
  Search,
  PlusCircle,
  Info,
  Database,
} from "lucide-react";
import type { Page } from "@/src/App";

const menuItems = [
  { id: "dashboard" as Page, label: "仪表盘", icon: LayoutDashboard },
  { id: "knowledge" as Page, label: "知识库", icon: Library },
  { id: "search" as Page, label: "语义搜索", icon: Search },
  { id: "add" as Page, label: "添加知识", icon: PlusCircle },
  { id: "about" as Page, label: "关于项目", icon: Info },
];

interface AppSidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function AppSidebar({ currentPage, onNavigate }: AppSidebarProps) {
  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">智能科研助手</div>
            <div className="text-xs text-muted-foreground">Powered by seekdb</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>导航</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={currentPage === item.id}
                    onClick={() => onNavigate(item.id)}
                    tooltip={item.label}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
        <div className="text-xs text-muted-foreground">
          OceanBase 大赛项目
          <br />
          seekdb 向量检索驱动
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
