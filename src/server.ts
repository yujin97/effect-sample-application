let successCounter = 0;

const server = Bun.serve({
  port: 3001,
  // `routes` requires Bun v1.2.3+
  routes: {
    "/effect-tests/1": async () => {
      return Response.json("success", { status: 200 });
    },
    "/effect-tests/2": async () => {
      if (successCounter % 2 === 0) {
        successCounter++;
        return Response.json("success", { status: 200 });
      }
      successCounter++;
      return Response.json("success", { status: 401 });
    },
    "/effect-tests/3": async () => {
      return Response.json("success", { status: 200 });
    },
    "/effect-tests/token-renew": async () => {
      return Response.json("renewed", { status: 200 });
    },
  },
  fetch(_) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at ${server.url}`);
