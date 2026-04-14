import { httpRouter } from "convex/server"
import { rtkWebhook } from "./webhooks"

const http = httpRouter()

http.route({ path: "/webhooks/rtk", method: "POST", handler: rtkWebhook })

export default http
