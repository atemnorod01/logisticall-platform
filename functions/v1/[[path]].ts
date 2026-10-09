import { proxyRequest, type ProxyEnvironment } from "../../apps/edge/proxy.js";
export const onRequest = ({
  request,
  env,
}: {
  request: Request;
  env: ProxyEnvironment;
}) => proxyRequest(request, env);
