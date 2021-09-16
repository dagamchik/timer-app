require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const nunjucks = require("nunjucks");
const { nanoid } = require("nanoid");
const crypto = require("crypto");
const moment = require("moment");
const { MongoClient } = require("mongodb");
const { ObjectId } = require("mongodb");

const http = require("http");
const { URL } = require("url");
const WebSocket = require("ws");
const cookie = require('cookie');

const clientPromise = MongoClient.connect(process.env.DB_URI, {
  useUnifiedTopology: true,
});

let dbs;
// let dbUser;
// let isActive;
const app = express();

nunjucks.configure("views", {
  autoescape: true,
  express: app,
  tags: {
    blockStart: "[%",
    blockEnd: "%]",
    variableStart: "[[",
    variableEnd: "]]",
    commentStart: "[#",
    commentEnd: "#]",
  },
});

app.set("view engine", "njk");

app.use(async (req, res, next) => {
  try {
    const client = await clientPromise;
    dbs = client.db("users");
    // isActive = req.query.isActive = 'true';
    req.db = client.db("users");
    next();
  } catch (err) {
    next(err);
  }
})

app.use(cookieParser());

const auth = () => async (req, res, next) => {
  if (!req.cookies["sessionId"]) {
    return next();
  }
  const user = await findUserBySessionId(req.db, req.cookies["sessionId"]);
  req.user = user;
  // dbUser = user;
  req.sessionId = req.cookies["sessionId"];
  next();
};

app.use(express.json());
app.use(express.static("public"));
const server = http.createServer(app);

const findUserByUsername = async (db, username) => {
  return db.collection("users")
    .findOne({ username })
};

const findUserBySessionId = async (db, sessionId) => {
  const session = await db.collection("sessions")
    .findOne(
      { sessionId },
      {
      projection: { userId: 1 }
      }
    );

  if (!session) {
    return;
  }

  return db.collection("users")
    .findOne({ _id: ObjectId(session.userId).toString() });
};

const createSession = async (db, userId) => {
  const sessionId = nanoid();
  await db.collection("sessions").insertOne({
    userId,
    sessionId,
  });
  return sessionId;
};

const deleteSession = async (db, sessionId) => {
  await db.collection("sessions").deleteOne({ sessionId });
};



// websocket
const wss = new WebSocket.Server({ server });
const clients = new Map();


server.on("upgrade", (req, socket, head) => {
  // const cookies = cookies.parse(req.header['cookie']);
  // const token = cookies && cookies.get("sessionId");
  // console.log(token);
  // if (!userId) {
  //   socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
  //   socket.destroy();
  //   return;
  // }
})

wss.on("connection", async (ws, req) => {
  const cookies = cookie.parse(req.headers['cookie']);
  const user = await findUserBySessionId(dbs, cookies.sessionId);
  const userId = user._id;
  clients.set(userId, ws);
  const timerDb = await dbs.collection("timers")
    .find({ user_id: user._id }).toArray()
  let message = timerDb;
  ws.on("close", () => {
    clients.delete(cookies.sessionId);
  });

  clients.get(userId, ws).send(
    JSON.stringify({
      type: "all_timers",
      data: message,
    })
  )
})

setInterval(() => {
  clients.forEach(async (ws, userId) => {
    let isActive = true;
    const timerDb = await dbs.collection("timers")
      .find({ user_id: userId }).toArray();

    const result = timerDb.filter((timer) => {
      return timer.isActive === Boolean(isActive);
    });
    if (isActive === true) {
      for (const timer of result) {
        timer.progress = Date.now() - Date.parse(timer.start);
      }
    }

    ws.send(JSON.stringify({
      type: "active_timers",
      data: result,
    }));
  })
  // clients.get(cookies.sessionId).send(
  //   JSON.stringify({
  //     type: "aсtive_timers",
  //     data: result,
  //   })
  // )
}, 1000)

app.get("/", auth(), (req, res) => {
  res.render("index", {
    user: req.user,
    authError: req.query.authError === "true" ? "Wrong username or password" : req.query.authError,
  });
});

app.post("/login", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  const user = await findUserByUsername(req.db, username);
  if (!user || hash !== user.password) {
    return res.status(400).redirect("/?authError=true");
  }
  const sessionId = await createSession(req.db, user._id);
  res.cookie("sessionId", sessionId, { httpOnly: true }).status(200).redirect("/");
});

app.get("/logout", auth(), async (req, res) => {
  if (!req.user) {
    return res.redirect("/");
  }
  await deleteSession(req.db, req.sessionId);
  res.clearCookie("sessionId").redirect("/");
});

app.post("/signup", bodyParser.urlencoded({ extended: false }), async (req, res) => {
  const hashPassword = crypto.createHash("sha256").update(req.body.password).digest("hex");
  const user = await findUserByUsername(req.db, req.body.username);
  if (!user) {
    const newUser = await req.db.collection("users")
      .insertOne({
        _id: ObjectId().toString(),
        username: req.body.username,
        password: hashPassword,
      })
        const sessionId = await createSession(req.db, newUser.insertedId);
        res.cookie("sessionId", sessionId, { httpOnly: true }).status(201).redirect("/");
  } else {
    res.status(400).send("Ошибка, пользователь с таким именем уже существует, вернитесь назад");
  }
});

app.get("/api/timers", auth(), async (req, res) => {
  const dateStr = moment().utc().format();
  const getTimer = await req.db.collection("timers")
    .find({ user_id: req.user._id }).toArray()
  let isActive = req.query.isActive === "true";
  const result = getTimer.filter((timer) => {
    return timer.isActive === isActive;
  });
  if (isActive === true) {
    for (const timer of result) {
      timer.progress = Date.parse(timer.start) - Date.parse(dateStr);
    }
  }
  res.send(result);
});

app.post("/api/timers", auth(), async (req, res) => {
  const dateStr = moment().utc().format();
  let body = req.body;
  const newTimer = await req.db.collection("timers")
    .insertOne({
      _id: ObjectId().toString(),
      user_id: ObjectId(req.user._id).toString(),
      description: body.description,
      start: dateStr,
      isActive: true,
    })
  return res.status(201).json(newTimer);
});

app.post("/api/timers/:timerId/stop", auth(), async (req, res) => {
  const dateStr = moment().utc().format();
  const getIdTimer = await req.db.collection("timers")
    .find({ isActive: true, user_id: ObjectId(req.user._id).toString() }).toArray();
  const { timerId } = req.params;
  const timer = await getIdTimer.find((timer) => timer._id === timerId);
  if (timer) {
    req.db.collection("timers")
      .updateOne({ _id: timer._id },
        { $set:
          { end: dateStr, isActive: false, duration: Date.parse(dateStr) - Date.parse(timer.start),}
        })
  }

  const result = await dbs.collection("timers")
    .find({ user_id: req.user._id }).toArray();

  clients.get(req.user._id).send(
    JSON.stringify({
      type: "all_timers",
      data: result,
    })
  )

  res.json({ _id: timer._id })
});


const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`  Listening on http://localhost:${port}`);
});
