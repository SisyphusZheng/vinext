export default {
  async rewrites() {
    return {
      beforeFiles: [{ source: "/before/:path*", destination: "/:path*" }],
      afterFiles: [{ source: "/after/:path*", destination: "/:path*" }],
      fallback: [{ source: "/fallback/:path*", destination: "/:path*" }],
    };
  },
};
