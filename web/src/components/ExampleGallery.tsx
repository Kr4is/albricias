/* eslint-disable @next/next/no-img-element */

/**
 * The invented editions of `lib/sample-editions.ts`, as the pictures the PNG
 * export made of them (`public/examples/`) — each opens full size. Shown on
 * the landing page and, whole, on `/examples`.
 */

const EXAMPLES = [
  { src: "/examples/edition-1.webp", width: 2400, height: 2730, title: "Weekly", caption: "Seven days of a compiler hobbyist, set as a front page with a side rail of briefs." },
  { src: "/examples/edition-2.webp", width: 2400, height: 2610, title: "Monthly", caption: "An August of releases and stars under a full-width banner." },
  { src: "/examples/edition-3.webp", width: 2400, height: 1726, title: "Quarterly", caption: "Three months of building an API, in four columns." },
];

export default function ExampleGallery({ count = EXAMPLES.length }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
      {EXAMPLES.slice(0, count).map((example) => (
        <figure key={example.src}>
          <a href={example.src} target="_blank" rel="noopener" className="block border border-ink bg-white shadow-md hover:shadow-xl transition-shadow">
            <img
              src={example.src}
              width={example.width}
              height={example.height}
              alt={`Sample edition: ${example.caption}`}
              loading="lazy"
              className="w-full h-auto block"
            />
          </a>
          <figcaption className="mt-3 font-body text-sm text-stone-600 leading-snug">
            <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-ink mr-2">{example.title}</span>
            {example.caption}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
