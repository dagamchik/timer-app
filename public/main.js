/*global UIkit, Vue */
(() => {

  const notification = (config) =>
    UIkit.notification({
      pos: "top-right",
      timeout: 5000,
      ...config,
    });

  const alert = (message) =>
    notification({
      message,
      status: "danger",
    });

  const info = (message) =>
    notification({
      message,
      status: "success",
    });

  const fetchJson = (...args) =>
    fetch(...args)
      .then((res) =>
        res.ok
          ? res.status !== 204
            ? res.json()
            : null
          : res.text().then((text) => {
              throw new Error(text);
            })
      )
      .catch((err) => {
        alert(err.message);
      });

  new Vue({
    el: "#app",
    data: {
      desc: "",
      activeTimers: [],
      oldTimers: [],
    },
    methods: {
      // fetchActiveTimers() {
      //   fetchJson("/api/timers?isActive=true").then((activeTimers) => {
      //     this.activeTimers = activeTimers;
      //   });
      // },
      // fetchOldTimers() {
      //   fetchJson("/api/timers?isActive=false").then((oldTimers) => {
      //     this.oldTimers = oldTimers;
      //   });
      // },
      createTimer() {
        const description = this.desc;
        this.desc = "";
        fetchJson("/api/timers", {
          method: "post",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ description }),
        }).then(({ id }) => {
          info(`Created new timer "${description}" [${id}]`);
          // this.fetchActiveTimers();
        });
      },
      stopTimer(id) {
        fetchJson(`/api/timers/${id}/stop`, {
          method: "post",
        }).then(() => {
          info(`Stopped the timer [${id}]`);
          // this.fetchActiveTimers();
          // this.fetchOldTimers();
        });
      },
      formatTime(ts) {
        return new Date(ts).toTimeString().split(" ")[0];
      },
      formatDuration(d) {
        d = Math.floor(d / 1000);
        const s = d % 60;
        d = Math.floor(d / 60);
        const m = d % 60;
        const h = Math.floor(d / 60);
        return [h > 0 ? h : null, m, s]
          .filter((x) => x !== null)
          .map((x) => (x < 10 ? "0" : "") + x)
          .join(":");
      },
    },
    created() {
      const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
      const client = new WebSocket(`${wsProto}//${location.host}`);

      client.addEventListener('message', (message) => {
        let data = JSON.parse(message.data);
        console.log('data.type', data.type);
        switch (data.type) {
          case "all_timers":
            this.activeTimers = data.data.filter((timer) => {
              return timer;
            })
            this.oldTimers = data.data.filter((timer) => {
              return timer.isActive === false;
            })
          case "active_timers":
            this.activeTimers = data.data;
            // .filter((timer) => {
            //   for (const timer of this.activeTimers) {
            //       timer.progress = Date.parse(timer.start) - Date.now();
            //   }
            //   return timer.isActive === true;
            // });
            break;
          default:
            break;
        }
      });
      // this.fetchActiveTimers();
      // setInterval(() => {
      //   this.fetchActiveTimers();
      // }, 1000);
      // this.fetchOldTimers();
    },
  });
})();
