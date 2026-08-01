const { Server } = require("socket.io");
const ViGEmClient = require("vigemclient");
const { keyboard, Key } = require("@nut-tree-fork/nut-js");

// No artificial delay between simulated key down/up — we want this to feel
// as instant as a real keypress, since it's driving macro buttons in a
// racing game.
keyboard.config.autoDelayMs = 0;

// Macro buttons that used to be routed to controller2's face/shoulder
// buttons clash with controller1's driving buttons (F1 2020 merges all
// connected gamepads into one logical input, so "B" on either controller
// triggers the same in-game action). Routing them to keyboard keys instead
// avoids the clash entirely — keyboard and gamepad are independent input
// channels, so steering/throttle/brake on controller1 keep working with
// zero interruption while these fire.
//
// In F1 2020, bind these actions (Settings > Controls > Keyboard) to the
// same keys used here: Radio, Overtake, Pit Limiter, Brake Bias +/-, DRS.
const macroKeyMap = {
  MACRO_OT: Key.M,
  MACRO_PL: Key.P,
  MACRO_BB_PLUS: Key.K,
  MACRO_BB_MINUS: Key.L,
  MACRO_DRS: Key.F,
  MACRO_RADIO: Key.T,
};

function initServer(send) {
  const io = new Server(3000, {
    cors: { origin: "*" },
    perMessageDeflate: false,
  });

  const client = new ViGEmClient();
  client.connect();

  // --- INISIALISASI DUA STIK ---
  // Stik 1: Buat input gas, rem, setir, dan tombol standar
  const controller1 = client.createX360Controller();
  controller1.connect();

  // Stik 2: sekarang cuma dipakai buat ERS +/- dan DIFF +/- (lewat D-pad
  // axis), karena itu satu-satunya sinyal yang gak bentrok sama controller1.
  // Semua macro tombol lain udah dipindah ke keyboard simulation di atas.
  const controller2 = client.createX360Controller();
  controller2.connect();

  send("vigem-status", { connected: true });

  let lastVib = { large: 0, small: 0 };

  // Efek getar dari game cukup diarahkan ke Stik 1 aja
  controller1.on("vibration", ({ large, small }) => {
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
      // --------------------------------------------------
      // ROUTING STIK 1 (Tombol Standar balapan)
      // --------------------------------------------------
      if (data.A !== lastIn.A) {
        controller1.button.A.setValue(data.A);
        lastIn.A = data.A;
      }
      if (data.B !== lastIn.B) {
        controller1.button.B.setValue(data.B);
        lastIn.B = data.B;
      }
      if (data.X !== lastIn.X) {
        controller1.button.X.setValue(data.X);
        lastIn.X = data.X;
      }
      if (data.Y !== lastIn.Y) {
        controller1.button.Y.setValue(data.Y);
        lastIn.Y = data.Y;
      }
      if (data.LB !== lastIn.LB) {
        controller1.button.LEFT_SHOULDER.setValue(data.LB);
        lastIn.LB = data.LB;
      }
      if (data.RB !== lastIn.RB) {
        controller1.button.RIGHT_SHOULDER.setValue(data.RB);
        lastIn.RB = data.RB;
      }
      if (data.RT !== lastIn.RT) {
        controller1.axis.rightTrigger.setValue(data.RT);
        lastIn.RT = data.RT;
      }
      if (data.LT !== lastIn.LT) {
        controller1.axis.leftTrigger.setValue(data.LT);
        lastIn.LT = data.LT;
      }
      if (data.LX !== lastIn.LX) {
        controller1.axis.leftX.setValue(data.LX);
        lastIn.LX = data.LX;
      }

      controller1.button.START.setValue(data.START ? 1 : 0);
      controller1.button.BACK.setValue(data.SELECT ? 1 : 0);
      controller1.button.LEFT_THUMB.setValue(data.L3 ? 1 : 0);
      controller1.button.RIGHT_THUMB.setValue(data.R3 ? 1 : 0);

      // --------------------------------------------------
      // ROUTING MACRO BUTTONS (keyboard simulation)
      // OT / PL / BB+ / BB- / DRS / RADIO — semuanya lewat keyboard
      // sekarang, bukan controller2 button, supaya gak nabrak input
      // controller1 (lihat komentar di macroKeyMap di atas).
      // --------------------------------------------------
      for (const [dataKey, keyCode] of Object.entries(macroKeyMap)) {
        if (data[dataKey] !== lastIn[dataKey]) {
          if (data[dataKey]) {
            keyboard.pressKey(keyCode);
          } else {
            keyboard.releaseKey(keyCode);
          }
          lastIn[dataKey] = data[dataKey];
        }
      }

      // --------------------------------------------------
      // ROUTING D-PAD (ERS +/- pakai axis vertikal, DIFF +/- pakai axis
      // horizontal) — ini tetap lewat controller2, karena controller1
      // gak pernah kirim sinyal D-pad sama sekali, jadi gak ada bentrok.
      // --------------------------------------------------
      const dpadVertVal = data.MACRO_ERS_PLUS
        ? 1
        : data.MACRO_ERS_MINUS
          ? -1
          : 0;
      if (dpadVertVal !== lastIn._dpadVert) {
        controller2.axis.dpadVert.setValue(dpadVertVal);
        lastIn._dpadVert = dpadVertVal;
      }

      const dpadHorzVal = data.MACRO_DIFF_PLUS
        ? 1
        : data.MACRO_DIFF_MINUS
          ? -1
          : 0;
      if (dpadHorzVal !== lastIn._dpadHorz) {
        controller2.axis.dpadHorz.setValue(dpadHorzVal);
        lastIn._dpadHorz = dpadHorzVal;
      }
    });

    socket.on("disconnect", () => {
      clearInterval(pingInterval);
      send("phone-status", { connected: false });
    });
  });

  return { io, controller: controller1, controller2 };
}

module.exports = initServer;
