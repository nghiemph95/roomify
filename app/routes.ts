import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("visualizer/:id", "./routes/visualizer.$id.tsx"),
  // Chrome DevTools đôi khi request path này; trả 404 để tránh "No route matches" trong terminal
  route(".well-known/*", "./routes/well-known.$.tsx"),
] satisfies RouteConfig;
