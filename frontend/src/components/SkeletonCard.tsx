/** Loading placeholder that matches QuestCard's layout to avoid layout shift. */
export default function SkeletonCard() {
  return (
    <div className="card relative overflow-hidden p-5" aria-hidden>
      <div className="flex items-center justify-between">
        <div className="h-6 w-24 rounded bg-white/10 animate-pulse" />
        <div className="h-6 w-16 rounded-pill bg-white/10 animate-pulse" />
      </div>
      <div className="mt-4 h-4 w-3/4 rounded bg-white/10 animate-pulse" />
      <div className="mt-2 h-4 w-1/2 rounded bg-white/10 animate-pulse" />
      <div className="mt-6 h-2 w-full rounded-pill bg-white/10 animate-pulse" />
      <div className="mt-4 flex items-center justify-between">
        <div className="h-8 w-20 rounded bg-white/10 animate-pulse" />
        <div className="h-8 w-24 rounded-pill bg-white/10 animate-pulse" />
      </div>
    </div>
  );
}
