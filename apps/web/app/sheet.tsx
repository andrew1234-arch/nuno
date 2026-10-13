/** Cream sheet on the warm background: the container for every page except the landing page. */
export function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="card w-full px-5 py-8 sm:px-10">{children}</div>
    </div>
  );
}
