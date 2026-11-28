const SchoolCRM = (() => {
  const $ = (id) => document.getElementById(id),
    esc = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const people = {
    teacher: "Алексей Сергеевич Иванов",
    director: "Наталья Викторовна Орлова",
    deputy: "Ольга Андреевна Соколова",
    admin: "Дмитрий Павлович Морозов",
  };
  const roles = {
    teacher: "Учитель / классный руководитель",
    director: "Директор",
    deputy: "Завуч",
    admin: "Администратор",
  };
  const crmPages = {
    classes: "Классы и педагоги",
    schedule: "Расписание",
    chat: "Сообщения",
    assignments: "Поручения школы",
    schoolCalendar: "Календарь школы",
    requests: "Обращения",
    admin: "Настройки",
  };
  const teacherPages = new Set([
    "tasks",
    "calendar",
    "students",
    "social",
    "digital",
    "gto",
    "reports",
    "passes",
    "profile",
  ]);
  let role = "teacher";
  let page = "home";
  let active = "";
  let contextClass = "";
  const teacherClass = "9А";
  const names = [
    "Елена Викторовна Смирнова",
    "Анна Сергеевна Петрова",
    "Мария Андреевна Волкова",
    "Ирина Павловна Кузнецова",
    "Сергей Олегович Лебедев",
    "Виктория Игоревна Белова",
  ];
  const classes = [
    "5А",
    "5Б",
    "5З",
    "6А",
    "6Б",
    "7А",
    "8А",
    "9А",
    "9Б",
    "9Ц",
    "10А",
    "11А",
  ].map((c, i) => ({
    c,
    n: [teacherClass, "9Ц"].includes(c) ? people.teacher : names[i % 6],
  }));
  const staff = [...new Set([...Object.values(people), ...names])];
  let state;
  try {
    state = JSON.parse(localStorage.getItem("allcrm-v1"));
  } catch {}
  if (
    !["messages", "tasks", "events", "requests"].every((key) =>
      Array.isArray(state?.[key]),
    )
  )
    state = null;
  state = state || {
    messages: [
      {
        chat: "Личный: " + people.teacher,
        from: names[2],
        to: people.teacher,
        text: "Добрый день! Нужно обсудить работу 9Ц на алгебре.",
        context: "9Ц",
      },
    ],
    tasks: [
      {
        title: "Проверить итоговые оценки",
        desc: "Проверить наличие итоговых оценок.",
        due: "2026-11-30",
        priority: "Важный",
        by: people.deputy,
        targets: ["9А", "9Б", "9Ц"],
        status: { "9А": "Выполнено", "9Б": "В работе", "9Ц": "Новое" },
        comments: [],
      },
    ],
    events: [
      {
        title: "Педагогический совет",
        date: "2026-12-01",
        aud: "Все педагоги",
      },
      { title: "Приём нормативов ГТО", date: "2026-12-02", aud: "5–6 классы" },
    ],
    requests: [],
  };
  function save() {
    try {
      localStorage.setItem("allcrm-v1", JSON.stringify(state));
    } catch {}
  }
  const manager = () => role === "director" || role === "deputy";
  const me = () => people[role];
  function canOpen(section) {
    if (section === "home") return true;
    if (teacherPages.has(section)) return role === "teacher";
    if (section === "admin") return role === "admin";
    return Object.hasOwn(crmPages, section);
  }
  function changeRole(value) {
    if (!Object.hasOwn(roles, value)) return;
    role = value;
    active = "";
    contextClass = "";
  }
  function go(section) {
    if (canOpen(section)) window.schoolGo(section);
  }
  function btn(t, js, primary = false) {
    return `<button class="${primary ? "primary" : ""}" onclick="${js}">${t}</button>`;
  }
  function card(t, b) {
    return `<div class="card"><h3>${t}</h3>${b}</div>`;
  }
  function line(a, b) {
    return `<div class="line"><div>${a}</div><div>${b}</div></div>`;
  }
  function mine(t) {
    return t.targets.filter(
      (x) => x === me() || classes.some((c) => c.c === x && c.n === me()),
    );
  }
  function visibleTasks() {
    return state.tasks.filter((t) => manager() || mine(t).length);
  }
  function openChat(n, c = "") {
    if (!staff.includes(n) || n === me()) return;
    active = "Личный: " + n;
    contextClass = c;
    go("chat");
  }
  function content(section) {
    if (!canOpen(section)) return "";
    page = section;
    let h = "";
    if (page === "home") {
      h =
        `<div class="grid">${[
          ["Поручения школы", visibleTasks().length],
          ["Сообщения", state.messages.filter((m) => m.to === me()).length],
          ["Классы", classes.length],
          ["Мероприятия", state.events.length],
        ]
          .map(([a, b]) => card(a, `<strong class="metric">${b}</strong>`))
          .join("")}</div>` +
        card(
          "Быстрый доступ",
          btn("Классные руководители", "SchoolCRM.go('classes')", true) +
            " " +
            btn("Моё расписание", "SchoolCRM.go('schedule')") +
            " " +
            btn("Поручения школы", "SchoolCRM.go('assignments')"),
        ) +
        card(
          "Требует внимания",
          visibleTasks()
            .map((t) => line(esc(t.title), esc(t.due)))
            .join("") || "Нет задач",
        );
    }
    if (page === "classes") {
      h =
        card(
          "Классные руководители",
          '<input aria-label="Поиск класса или ФИО" placeholder="Поиск класса или ФИО" oninput="SchoolCRM.filterClasses(this.value)"><div id="cl">' +
            classRows("") +
            "</div>",
        ) +
        card(
          "Сотрудники",
          staff
            .map((n) =>
              line(esc(n), btn("Написать", `SchoolCRM.openChat('${n}')`)),
            )
            .join(""),
        );
    }
    if (page === "schedule") {
      h = card(
        "Выберите класс",
        '<select aria-label="Класс" onchange="SchoolCRM.showLessons(this.value)">' +
          classes
            .map(
              (c) =>
                `<option ${c.c === teacherClass ? "selected" : ""}>${c.c}</option>`,
            )
            .join("") +
          '</select><div id="lessons">' +
          lessons(teacherClass) +
          "</div>",
      );
    }
    if (page === "chat") {
      let groups = [
        "Педагоги 9Ц",
        "Классные руководители 9-х классов",
        "Методическое объединение",
        "Администрация сообщает",
      ];
      h = card(
        "Диалоги",
        `<select aria-label="Диалог" onchange="SchoolCRM.selectChat(this.value)"><option value="">Выберите чат</option>${[...staff.filter((n) => n !== me()).map((n) => "Личный: " + n), ...groups].map((n) => `<option ${active === n ? "selected" : ""}>${n}</option>`).join("")}</select>`,
      );
      if (active) {
        let personal = active.startsWith("Личный: "),
          to = active.slice(8);
        let msgs = state.messages.filter((m) =>
          personal
            ? (m.from === me() && m.to === to) ||
              (m.from === to && m.to === me())
            : m.chat === active,
        );
        h += card(
          esc(active),
          msgs
            .map(
              (m) =>
                `<div class="bubble"><small>${esc(m.from)} ${m.context ? " · " + esc(m.context) : ""}</small><br>${esc(m.text)}</div>`,
            )
            .join("") +
            `<textarea id="msg" aria-label="Сообщение" placeholder="Сообщение"></textarea>${btn("Отправить", "SchoolCRM.send()", true)}`,
        );
      }
    }
    if (page === "assignments") {
      h = "";
      if (manager())
        h += card(
          "Новое поручение",
          `<input id="tt" aria-label="Название поручения" placeholder="Название"><label for="td">Описание</label><textarea id="td"></textarea><label for="aud">Получатели</label><select id="aud" onchange="SchoolCRM.targets()"><option value="parallel">Классные руководители параллелей</option><option value="class">Конкретные классы</option><option value="leaders">Все классные руководители</option><option value="all">Все педагоги</option><option value="person">Конкретные сотрудники</option></select><div id="targets"></div><label for="due">Срок</label><input id="due" type="date" value="2026-11-30"><select id="priority" aria-label="Приоритет"><option>Обычный</option><option>Важный</option><option>Срочный</option></select> ${btn("Назначить", "SchoolCRM.createTask()", true)}`,
        );
      h += visibleTasks()
        .map((t) => {
          let i = state.tasks.indexOf(t),
            done = t.targets.filter((x) => t.status[x] === "Выполнено").length;
          return card(
            esc(t.title),
            `<p>${esc(t.desc)}</p><span class="pill">${esc(t.priority)} · до ${esc(t.due)}</span><p class="muted">Автор: ${esc(t.by)}</p>${manager() ? `<p>Выполнено ${done} из ${t.targets.length}</p><div class="bar"><i style="width:${(100 * done) / t.targets.length}%"></i></div>` : ""}${(manager() ? t.targets : mine(t)).map((x) => line(esc(x), manager() ? esc(t.status[x]) : `<select aria-label="Статус поручения" onchange="SchoolCRM.updateTask(${i},${t.targets.indexOf(x)},this.value)">${statuses.map((s) => `<option ${t.status[x] === s ? "selected" : ""}>${s}</option>`).join("")}</select>`)).join("")}${t.comments.map((c) => `<div class="bubble">${esc(c)}</div>`).join("")}<input id="comment${i}" aria-label="Комментарий" placeholder="Комментарий"> ${btn("Добавить", `SchoolCRM.comment(${i})`)}`,
          );
        })
        .join("");
    }
    if (page === "schoolCalendar") {
      h =
        (manager()
          ? card(
              "Добавить мероприятие",
              `<input id="et" aria-label="Название мероприятия" placeholder="Название"><input id="ed" aria-label="Дата мероприятия" type="date"><input id="ea" aria-label="Участники" placeholder="Участники"> ${btn("Добавить", "SchoolCRM.eventAdd()", true)}`,
            )
          : "") +
        card(
          "Мероприятия",
          state.events
            .map((e) =>
              line(
                `<b>${esc(e.title)}</b><div class="muted">${esc(e.aud)}</div>`,
                esc(e.date),
              ),
            )
            .join(""),
        );
    }
    if (page === "requests") {
      h =
        card(
          "Новое обращение",
          `<select id="rc" aria-label="Класс">${classes.map((c) => `<option>${c.c}</option>`).join("")}</select><textarea id="rt" aria-label="Текст обращения" placeholder="Опишите ситуацию"></textarea>${btn("Отправить классному руководителю", "SchoolCRM.requestAdd()", true)}`,
        ) +
        state.requests
          .filter((r) => manager() || r.from === me() || r.to === me())
          .map((r) =>
            card(
              "Класс " + esc(r.c),
              `<p>${esc(r.text)}</p><p class="muted">${esc(r.from)} → ${esc(r.to)}</p>${esc(r.status)} ${r.to === me() || manager() ? btn("В работу", `SchoolCRM.requestStatus(${state.requests.indexOf(r)},'В работе')`) + btn("Решено", `SchoolCRM.requestStatus(${state.requests.indexOf(r)},'Решено')`) : ""}`,
            ),
          )
          .join("");
    }
    if (page === "admin")
      h =
        card(
          "Роли и сотрудники",
          Object.entries(people)
            .map(([r, n]) =>
              line(
                esc(n),
                {
                  teacher: "Учитель / КР",
                  director: "Директор",
                  deputy: "Завуч",
                  admin: "Администратор",
                }[r],
              ),
            )
            .join(""),
        ) +
        card(
          "Демонстрационные данные",
          btn("Сбросить демо", "SchoolCRM.reset()"),
        );
    return h;
  }
  function classRows(q) {
    return classes
      .filter((c) => (c.c + " " + c.n).toLowerCase().includes(q.toLowerCase()))
      .map((c) =>
        line(
          `<b>${c.c}</b> · ${esc(c.n)}`,
          c.n === me()
            ? "Ваш класс"
            : btn("Чат", `SchoolCRM.openChat('${c.n}','${c.c}')`, true),
        ),
      )
      .join("");
  }
  function filterClasses(q) {
    if (!$("cl")) return;
    $("cl").innerHTML = classRows(q);
  }
  function lessons(c) {
    return (
      [
        "Русский язык",
        "История",
        "Геометрия",
        "Алгебра",
        "Физкультура",
        "Английский язык",
      ]
        .map((s, i) =>
          line(
            `<b>${8 + i}:30 · ${s}</b><div class="muted">${names[i]} · Каб. ${201 + i}</div>`,
            btn("Предметник", `SchoolCRM.openChat('${names[i]}','${c}')`),
          ),
        )
        .join("") +
      btn(
        "Классный руководитель",
        `SchoolCRM.openChat('${classes.find((x) => x.c === c).n}','${c}')`,
        true,
      )
    );
  }
  function showLessons(c) {
    if (!$("lessons") || !classes.some((item) => item.c === c)) return;
    $("lessons").innerHTML = lessons(c);
  }
  function selectChat(value) {
    active = value;
    contextClass = "";
    render();
  }
  function send() {
    if (page !== "chat" || !active || !$("msg")) return;
    let text = $("msg").value.trim();
    if (!text) return;
    state.messages.push({
      chat: active,
      from: me(),
      to: active.startsWith("Личный: ") ? active.slice(8) : active,
      text,
      context: contextClass || "",
    });
    save();
    render();
  }
  function targets() {
    if (!manager() || !$("aud")) return;
    let a = $("aud").value,
      arr =
        a === "parallel"
          ? [...new Set(classes.map((c) => c.c.match(/^\d+/)[0]))]
          : a === "class"
            ? classes.map((c) => c.c)
            : a === "person"
              ? staff
              : [];
    $("targets").innerHTML = arr
      .map(
        (x) =>
          `<label style="display:inline-block;margin:8px"><input type="checkbox" value="${x}"> ${x}</label>`,
      )
      .join("");
  }
  function createTask() {
    if (!manager() || page !== "assignments" || !$("tt")) return;
    let title = $("tt").value.trim(),
      a = $("aud").value,
      sel = [...$("targets").querySelectorAll("input:checked")].map(
        (x) => x.value,
      ),
      ts =
        a === "all"
          ? staff
          : a === "leaders"
            ? classes.map((c) => c.c)
            : a === "parallel"
              ? classes
                  .filter((c) => sel.includes(c.c.match(/^\d+/)[0]))
                  .map((c) => c.c)
              : sel;
    if (!title || !ts.length || !$("due").value)
      return alert("Укажите название, получателей и срок");
    state.tasks.push({
      title,
      desc: $("td").value,
      due: $("due").value,
      priority: $("priority").value,
      by: me(),
      targets: ts,
      status: Object.fromEntries(ts.map((x) => [x, "Новое"])),
      comments: [],
    });
    save();
    render();
  }
  function updateTask(i, targetIndex, s) {
    const task = state.tasks[i];
    const target = task?.targets[targetIndex];
    if (
      page !== "assignments" ||
      manager() ||
      !task ||
      !mine(task).includes(target) ||
      !statuses.includes(s)
    )
      return;
    task.status[target] = s;
    save();
    render();
  }
  function comment(i) {
    if (
      page !== "assignments" ||
      !visibleTasks().includes(state.tasks[i]) ||
      !$("comment" + i)
    )
      return;
    let v = $("comment" + i).value.trim();
    if (v) state.tasks[i].comments.push(me() + ": " + v);
    save();
    render();
  }
  function eventAdd() {
    if (!manager() || page !== "schoolCalendar" || !$("et")) return;
    const title = $("et").value.trim();
    if (!title || !$("ed").value) return;
    state.events.push({
      title,
      date: $("ed").value,
      aud: $("ea").value || "Все педагоги",
    });
    save();
    render();
  }
  function requestAdd() {
    if (page !== "requests" || !$("rc")) return;
    let c = $("rc").value,
      text = $("rt").value.trim();
    const recipient = classes.find((item) => item.c === c);
    if (!text || !recipient) return;
    state.requests.push({
      c,
      text,
      from: me(),
      to: recipient.n,
      status: "Новое",
    });
    save();
    render();
  }
  function requestStatus(i, s) {
    const request = state.requests[i];
    if (
      page !== "requests" ||
      !request ||
      (!manager() && request.to !== me()) ||
      !["В работе", "Решено"].includes(s)
    )
      return;
    state.requests[i].status = s;
    save();
    render();
  }
  const statuses = ["Новое", "В работе", "На проверке", "Выполнено"];
  function render() {
    go(page);
  }
  function reset() {
    if (role !== "admin" || !confirm("Сбросить демонстрационные данные CRM?"))
      return;
    try {
      localStorage.removeItem("allcrm-v1");
    } catch {}
    location.reload();
  }
  return Object.freeze({
    teacherClass,
    roles: Object.freeze(roles),
    pages: Object.freeze(crmPages),
    canOpen,
    changeRole,
    isTeacher: () => role === "teacher",
    name: me,
    content,
    go,
    openChat,
    filterClasses,
    showLessons,
    selectChat,
    send,
    targets,
    createTask,
    updateTask,
    comment,
    eventAdd,
    requestAdd,
    requestStatus,
    reset,
  });
})();
