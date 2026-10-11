/** Cream sheet on the warm background: the container for every page except the landing page. */
export function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-6 sm:px-4">
      <div className="card mx-auto max-w-6xl px-5 py-8 sm:px-10">{children}</div>
    </div>
  );
}
