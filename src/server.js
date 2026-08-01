const { Server } = require("socket.io");
const ViGEmClient = require("vigemclient");

function initServer(send) {
  const io = new Server(3000, {
    cors: { origin: "*" },
    perMessageDeflate: false,
  });

  const client = new ViGEmClient();
  client.connect();
  const controller = client.createX360Controller();
  controller.connect();
  send("vigem-status", { connected: true });

  let lastVib = { large: 0, small: 0 };
  controller.on("vibration", ({ large, small }) => {
    if (large !== lastVib.large || small !== lastVib.small) {
      io.volatile.emit("vibrationData", { large, small });
      lastVib = { large, small };
    }
  });

  io.on("connection", (socket) => {
    send("phone-status", { connected: true });

    // Ping check
    const pingInterval = setInterval(() => {
      socket.emit("cek-ping", Date.now());
    }, 1000);

    socket.on("pantulan-ping", (waktuDariServer) => {
      const realPing = Date.now() - waktuDariServer;
      send("latency", { ms: realPing });
    });

    let lastIn = {};
    socket.on("controllerInput", (data) => {
      if (data.A !== lastIn.A) {
        controller.button.A.setValue(data.A);
        lastIn.A = data.A;
      }
      if (data.B !== lastIn.B) {
        controller.button.B.setValue(data.B);
        lastIn.B = data.B;
      }
      if (data.X !== lastIn.X) {
        controller.button.X.setValue(data.X);
        lastIn.X = data.X;
      }
      if (data.Y !== lastIn.Y) {
        controller.button.Y.setValue(data.Y);
        lastIn.Y = data.Y;
      }
      if (data.LB !== lastIn.LB) {
        controller.button.LEFT_SHOULDER.setValue(data.LB);
        lastIn.LB = data.LB;
      }
      if (data.RB !== lastIn.RB) {
        controller.button.RIGHT_SHOULDER.setValue(data.RB);
        lastIn.RB = data.RB;
      }
      if (data.RT !== lastIn.RT) {
        controller.axis.rightTrigger.setValue(data.RT);
        lastIn.RT = data.RT;
      }
      if (data.LT !== lastIn.LT) {
        controller.axis.leftTrigger.setValue(data.LT);
        lastIn.LT = data.LT;
      }
      if (data.LX !== lastIn.LX) {
        controller.axis.leftX.setValue(data.LX);
        lastIn.LX = data.LX;
      }
      controller.button.START.setValue(state.START ? 1 : 0);
      controller.button.BACK.setValue(state.SELECT ? 1 : 0);
      controller.button.LEFT_THUMB.setValue(state.L3 ? 1 : 0);
      controller.button.RIGHT_THUMB.setValue(state.R3 ? 1 : 0);
    });

    socket.on("disconnect", () => {
      clearInterval(pingInterval);
      send("phone-status", { connected: false });
    });
  });

  return { io, controller };
}

module.exports = initServer;
