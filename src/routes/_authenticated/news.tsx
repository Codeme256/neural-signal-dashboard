import { createFileRoute, Link } from "@tanstack/react-router";
import { PreNewsCalendar } from "@/components/signal/PreNewsCalendar";
import { NeuralCanvas } from "@/components/signal/NeuralCanvas";
import { UserMenu } from "@/components/auth/UserMenu";

export const Route = createFileRoute("/_authenticated/news")({
 head: () => ({meta: [{title:"APEX Pre-News Detector — Economic Calendar"}]}),
 component: NewsPage,
});
function NewsPage() {
 return <div className="relative min-h-screen overflow-hidden bg-background">
  <NeuralCanvas className="pointer-events-none fixed inset-0 h-full w-full opacity-60" />
  <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-8">
   <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
    <div><h1 className="font-display text-2xl font-bold">APEX <span className="text-primary">PRE-NEWS DETECTOR</span></h1>
    <p className="text-xs text-muted-foreground">Upcoming market-impact events · Verified calendar · Conditional scenarios</p></div>
    <div className="flex items-center gap-3"><Link to="/" className="chip">← DASHBOARD</Link><UserMenu /></div>
   </header>
   <PreNewsCalendar />
  </main>
 </div>;
}
