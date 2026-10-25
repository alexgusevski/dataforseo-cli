globalThis.fetch = async (url, init = {}) => {
  if (process.env.FAIL_ON_FETCH === "1") {
    throw new Error("FETCH_CALLED");
  }

  const href = String(url);
  const isAiRequest = new URL(href).pathname.endsWith(".ai");
  const body = init.body === undefined ? null : JSON.parse(String(init.body));
  const headers = { "content-type": "application/json" };

  if (process.env.MOCK_HUGE_API_ERROR === "1") {
    const message = `\u001b${"x".repeat(100_000)}\u202e`;
    return new Response(
      JSON.stringify({
        status_code: 40501,
        status_message: message,
        tasks: [{ id: "huge-task", status_code: 40501, status_message: message }],
      }),
      { headers },
    );
  }

  if (process.env.MOCK_API_ERROR === "1") {
    return new Response(
      JSON.stringify({
        status_code: 40501,
        status_message: "Request rejected.",
        tasks: [
          {
            id: "bad-task",
            status_code: 40501,
            status_message: "Field-specific validation failed.",
            data: { keyword: "" },
            result: null,
          },
        ],
      }),
      { headers },
    );
  }

  if (process.env.MOCK_EMPTY_AI === "1" && isAiRequest) {
    return new Response(
      JSON.stringify({
        id: "empty-task",
        status_code: 20000,
        status_message: "Ok.",
        items: [],
      }),
      { headers },
    );
  }

  if (process.env.MOCK_AI_PARTIAL === "1" && isAiRequest) {
    return new Response(
      JSON.stringify({
        id: "partial-task",
        status_code: 40106,
        status_message: "Task Completed. Results are partial.\u001b\u202e",
        items: [{ keyword: "partial result" }],
      }),
      { headers },
    );
  }

  if (href.includes("/task_post")) {
    return new Response(
      JSON.stringify({
        status_code: 20000,
        status_message: "Ok.",
        cost: 0.01,
        tasks: [
          {
            id: "created-task",
            status_code: 20100,
            status_message: "Task Created.",
            result: null,
          },
        ],
      }),
      { headers },
    );
  }

  const item = { href, method: init.method, body };
  if (isAiRequest) {
    return new Response(
      JSON.stringify({
        id: "compact-task",
        status_code: 20000,
        status_message: "Ok.",
        items: [item],
      }),
      { headers },
    );
  }

  return new Response(
    JSON.stringify({
      version: "0.1",
      status_code: 20000,
      status_message: "Ok.",
      tasks: [
        {
          id: "full-task",
          status_code: 20000,
          status_message: "Ok.",
          cost: 0.02,
          result: [{ items: [item] }],
        },
      ],
    }),
    { headers },
  );
};
