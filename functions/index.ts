import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from "./_qoder/backend.mjs";
import { application } from "./routes.mjs";

// _qoder/ 由平台在部署前注入（数据库客户端、站点上下文、统一错误响应），
// 不要在仓库中创建该目录，也不要把数据库凭据写入本项目任何文件。
const handle = application({ db: createDatabaseClient(), BackendError });

Deno.serve(async (request) => {
  let context;
  try {
    context = createSiteContext(request);
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
