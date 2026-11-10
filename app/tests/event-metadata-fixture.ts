// Minimal public event shape; no provider guest, ticket, payment or identity records.
export function eventPage(url = "https://luma.com/blxy7j09") {
  const event = {
    "@context": "https://schema.org",
    "@type": "Event",
    url,
    name: "DevDay Exchange Community Demo Night: Bratislava",
    startDate: "2026-11-09T18:00:00.000+01:00",
    description: "<p>A fixture description for community demos.</p>",
    location: { "@type": "Place", name: "ESET", address: { addressLocality: "Bratislava" } },
  };
  const next = {
    props: {
      pageProps: {
        initialData: {
          kind: "event",
          data: {
            event: {
              name: event.name,
              url: new URL(url).pathname.slice(1),
              start_at: "2026-11-09T17:00:00.000Z",
              timezone: "Europe/Prague",
              visibility: "public",
              geo_address_visibility: "public",
              geo_address_info: { full_address: "ESET, Aupark Tower, Bratislava, Slovakia" },
            },
          },
        },
      },
    },
  };
  return (
    `<html><head><script type="application/ld+json">${JSON.stringify(event)}</script>` +
    '<script src="/unused.js"></script>'.repeat(70) +
    `</head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></body></html>`
  );
}
