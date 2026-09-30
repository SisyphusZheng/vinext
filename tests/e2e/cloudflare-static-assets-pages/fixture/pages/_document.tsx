import Document, { type DocumentContext } from "next/document";

export default class CustomDocument extends Document {
  static async getInitialProps(ctx: DocumentContext) {
    const props = await Document.getInitialProps(ctx);
    if (ctx.pathname === "/accepted" && ctx.res) ctx.res.statusCode = 202;
    return props;
  }
}
