const { Server } = require("socket.io");
const ViGEmClient = require("vigemclient");

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

  // Stik 2: Khusus buat tombol makro (Overtake, Pit Limiter, dll)
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

      // Fix bug: diganti dari 'state' ke 'data'
      controller1.button.START.setValue(data.START ? 1 : 0);
      controller1.button.BACK.setValue(data.SELECT ? 1 : 0);
      controller1.button.LEFT_THUMB.setValue(data.L3 ? 1 : 0);
      controller1.button.RIGHT_THUMB.setValue(data.R3 ? 1 : 0);

      // --------------------------------------------------
      // ROUTING STIK 2 (Tombol Makro)
      // --------------------------------------------------

      // MACRO_OT dipetakan ke tombol 'A' di Stik 2
      if (data.MACRO_OT !== lastIn.MACRO_OT) {
        controller2.button.A.setValue(data.MACRO_OT ? 1 : 0);
        lastIn.MACRO_OT = data.MACRO_OT;
      }

      // PL (Pit Limiter) dipetakan ke tombol 'B' di Stik 2
      if (data.PL !== lastIn.PL) {
        controller2.button.B.setValue(data.PL ? 1 : 0);
        lastIn.PL = data.PL;
      }

      // BB+ (Brake Bias Naik) dipetakan ke 'X' di Stik 2
      if (data.BB_PLUS !== lastIn.BB_PLUS) {
        controller2.button.X.setValue(data.BB_PLUS ? 1 : 0);
        lastIn.BB_PLUS = data.BB_PLUS;
      }

      // BB- (Brake Bias Turun) dipetakan ke 'Y' di Stik 2
      if (data.BB_MINUS !== lastIn.BB_MINUS) {
        controller2.button.Y.setValue(data.BB_MINUS ? 1 : 0);
        lastIn.BB_MINUS = data.BB_MINUS;
      }
      // DRS dipetakan ke tombol 'RB' (Right Bumper) di Stik 2
      if (data.MACRO_DRS !== lastIn.MACRO_DRS) { 
        controller2.button.RIGHT_SHOULDER.setValue(data.MACRO_DRS ? 1 : 0); 
        lastIn.MACRO_DRS = data.MACRO_DRS; 
      }
      
      // ERS+ dipetakan ke 'D-Pad Atas' di Stik 2
      if (data.MACRO_ERS_PLUS !== lastIn.MACRO_ERS_PLUS) { 
        controller2.button.DPAD_UP.setValue(data.MACRO_ERS_PLUS ? 1 : 0); 
        lastIn.MACRO_ERS_PLUS = data.MACRO_ERS_PLUS; 
      }
      
      // ERS- dipetakan ke 'D-Pad Bawah' di Stik 2
      if (data.MACRO_ERS_MINUS !== lastIn.MACRO_ERS_MINUS) { 
        controller2.button.DPAD_DOWN.setValue(data.MACRO_ERS_MINUS ? 1 : 0); 
        lastIn.MACRO_ERS_MINUS = data.MACRO_ERS_MINUS; 
      }
      
      // DIFF+ dipetakan ke 'D-Pad Kanan' di Stik 2
      if (data.MACRO_DIFF_PLUS !== lastIn.MACRO_DIFF_PLUS) { 
        controller2.button.DPAD_RIGHT.setValue(data.MACRO_DIFF_PLUS ? 1 : 0); 
        lastIn.MACRO_DIFF_PLUS = data.MACRO_DIFF_PLUS; 
      }

      // DIFF- dipetakan ke 'D-Pad Kiri' di Stik 2 (INI YANG BARU)
      if (data.MACRO_DIFF_MINUS !== lastIn.MACRO_DIFF_MINUS) { 
        controller2.button.DPAD_LEFT.setValue(data.MACRO_DIFF_MINUS ? 1 : 0); 
        lastIn.MACRO_DIFF_MINUS = data.MACRO_DIFF_MINUS; 
      }

      // RADIO dipetakan ke 'LB' (Left Bumper) di Stik 2 (Kalau lu pake)
      if (data.MACRO_RADIO !== lastIn.MACRO_RADIO) { 
        controller2.button.LEFT_SHOULDER.setValue(data.MACRO_RADIO ? 1 : 0); 
        lastIn.MACRO_RADIO = data.MACRO_RADIO; 
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
