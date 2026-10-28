import { useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Dashboard } from "@/components/Dashboard";
import { KnowledgeList } from "@/components/KnowledgeList";
import { SearchPage } from "@/components/SearchPage";
import { AddKnowledge } from "@/components/AddKnowledge";
import { AboutPage } from "@/components/AboutPage";

export type Page = "dashboard" | "knowledge" | "search" | "add" | "about";

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard onNavigate={setCurrentPage} />;
      case "knowledge":
        return <KnowledgeList />;
      case "search":
        return <SearchPage />;
      case "add":
        return <AddKnowledge />;
      case "about":
        return <AboutPage />;
      default:
        return <Dashboard onNavigate={setCurrentPage} />;
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-dvh">
        <AppSidebar currentPage={currentPage} onNavigate={setCurrentPage} />
        <main className="flex-1 overflow-auto">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-2 md:hidden">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-semibold">智能科研助手</span>
          </div>
          <div className="mx-auto max-w-6xl p-6 md:p-8">{renderPage()}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
