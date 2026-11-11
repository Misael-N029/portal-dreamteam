import * as React from "react";
import { CalendarClock, History, LayoutDashboard, PlugZap, Users } from "lucide-react";
import { PageHeader } from "@/components/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { ConnectionsTab } from "./connections-tab";
import { HistoryTab } from "./history-tab";
import { OverviewTab } from "./overview-tab";
import { RecipientsTab } from "./recipients-tab";
import { ReportsTab } from "./reports-tab";
import { RunDrawer } from "./run-drawer";
import { useCanManageReports } from "./shared";

/** Centro de Reportes: reportes del CRM programados por correo y WhatsApp */
export function ReportsScreen() {
  const manage = useCanManageReports();
  const [runId, setRunId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState(() => {
    try {
      return sessionStorage.getItem("reports-tab") ?? "overview";
    } catch {
      return "overview";
    }
  });
  const changeTab = (t: string) => {
    setTab(t);
    try {
      sessionStorage.setItem("reports-tab", t);
    } catch {
      /* noop */
    }
  };

  return (
    <>
      <PageHeader title="Centro de Reportes" description="Reportes del CRM que salen solos por correo y WhatsApp, con el contenido y los horarios que definas." />
      <Tabs value={tab} onValueChange={changeTab} className="grid gap-6">
        <TabsList className="w-fit max-w-full overflow-x-auto">
          <TabsTrigger value="overview">
            <LayoutDashboard /> Resumen
          </TabsTrigger>
          <TabsTrigger value="reports">
            <CalendarClock /> Reportes
          </TabsTrigger>
          <TabsTrigger value="recipients">
            <Users /> Destinatarios
          </TabsTrigger>
          <TabsTrigger value="history">
            <History /> Historial
          </TabsTrigger>
          {manage && (
            <TabsTrigger value="connections">
              <PlugZap /> Conexiones
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab onOpenRun={setRunId} />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab onOpenRun={setRunId} />
        </TabsContent>
        <TabsContent value="recipients">
          <RecipientsTab />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab onOpenRun={setRunId} />
        </TabsContent>
        {manage && (
          <TabsContent value="connections">
            <ConnectionsTab />
          </TabsContent>
        )}
      </Tabs>
      <RunDrawer runId={runId} onClose={() => setRunId(null)} />
    </>
  );
}
