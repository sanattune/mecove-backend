import http from "node:http";

const port = 3000;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("OK");
    return;
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain");
  res.end("Not Found");
});

server.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
