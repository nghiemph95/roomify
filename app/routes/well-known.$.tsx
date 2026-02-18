/**
 * Route cho /.well-known/* (vd. Chrome DevTools request /.well-known/appspecific/com.chrome.devtools.json).
 * Trả 404 để không crash dev server khi không có route match.
 */
export function loader() {
  return new Response(null, { status: 404 });
}

export default function WellKnown() {
  return null;
}
