(function () {
  var storageKey = "hoshiViewMode";
  var root = document.documentElement;
  var viewport = document.querySelector('meta[name="viewport"]');
  var buttons = document.querySelectorAll("[data-view-mode-button]");

  function saveMode(mode) {
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch (error) {
      return;
    }
  }

  function loadMode() {
    try {
      return window.localStorage.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function requestedMode() {
    try {
      var mode = new URLSearchParams(window.location.search).get("view");
      return mode === "pc" || mode === "sp" ? mode : null;
    } catch (error) {
      return null;
    }
  }

  function setMode(mode) {
    var nextMode = mode === "pc" ? "pc" : "sp";
    root.setAttribute("data-view-mode", nextMode);

    if (viewport) {
      viewport.setAttribute("content", nextMode === "pc" ? "width=1100" : "width=device-width, initial-scale=1");
    }

    buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-view-mode-button") === nextMode ? "true" : "false");
    });

    saveMode(nextMode);
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      setMode(button.getAttribute("data-view-mode-button"));
    });
  });

  var savedMode = loadMode();
  var initialMode = requestedMode() || (savedMode === "pc" || savedMode === "sp" ? savedMode : null);
  setMode(initialMode || (window.innerWidth <= 480 ? "sp" : "pc"));
})();

(function () {
  var totalElement = document.querySelector("[data-discord-total-count]");
  var breakdownElement = document.querySelector("[data-discord-breakdown]");

  if (!totalElement || !breakdownElement) {
    return;
  }

  function readCount(element, attributeName) {
    var value = element.getAttribute(attributeName);

    if (value === null || value === "") {
      return null;
    }

    // まずそのまま数値化を試みる
    var count = Number(value);
    if (Number.isFinite(count)) {
      return count;
    }

    // 数字が混在する文字列の場合、最初の連続した数字列を抽出して数値化する
    var m = String(value).match(/\d+/);
    if (m) {
      var n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    }

    return null;
  }

  function readCorrection(element, attributeName) {
    var count = readCount(element, attributeName);
    return count === null ? 0 : Math.max(0, Math.floor(count));
  }

  var botCount = readCount(breakdownElement, "data-bot-count") || 0;
  var exactTotalCount = readCount(totalElement, "data-total-count");
  var shouldAutoUpdate = totalElement.getAttribute("data-auto-count") === "true";
  var humanSubtract = readCorrection(breakdownElement, "data-human-subtract");
  var inviteCode = totalElement.getAttribute("data-invite-code") || "a26JJr3hVz";

  var lastTotalCount = null;
  var lastUpdatedAt = null;

  function formatUpdatedAt(date) {
    var parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date).reduce(function (result, part) {
      result[part.type] = part.value;
      return result;
    }, {});

    return parts.month + "/" + parts.day + " " + parts.hour + ":" + parts.minute;
  }

  function calculateHumanCount(totalCount, botCount) {
    return Math.max(totalCount - botCount - humanSubtract, 0);
  }

  function renderCount(totalCount, botCount, updatedAt) {
    var humanCount = calculateHumanCount(totalCount, botCount);
    var displayTotal = botCount + humanCount;
    var totalSubtract = Math.max(totalCount - displayTotal, 0);
    totalElement.setAttribute("data-subtract", String(totalSubtract));

    totalElement.textContent = "現在の合計参加人数：" + displayTotal + "人 (" + updatedAt + "更新)";
    breakdownElement.textContent = "Bot：" + botCount + "人・人間：" + humanCount + "人";
    lastUpdatedAt = updatedAt;
  }

  function updateCount(totalCount, botCount) {
    renderCount(totalCount, botCount, formatUpdatedAt(new Date()));
  }

  function firstFiniteNumber(values) {
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] === undefined || values[i] === null || values[i] === "") {
        continue;
      }

      var value = Number(values[i]);
      if (Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  function parseUpdatedAt(value) {
    if (!value) {
      return new Date();
    }

    var date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : new Date();
  }

  function normalizeStats(data) {
    var totalCount = firstFiniteNumber([
      data.total,
      data.member_count,
      data.approximate_member_count,
      data.profile && data.profile.member_count
    ]);
    var apiBotCount = firstFiniteNumber([data.bot, data.bot_count]);

    if (totalCount === null) {
      throw new Error("Discordの人数取得結果が不正です");
    }

    return {
      total: Math.max(0, Math.floor(totalCount)),
      bot: apiBotCount === null ? botCount : Math.max(0, Math.floor(apiBotCount)),
      updatedAt: parseUpdatedAt(data.updatedAt)
    };
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Discordの人数取得に失敗しました (status: " + response.status + ")");
        }

        return response.json();
      })
      .then(normalizeStats);
  }

  function renderStats(stats) {
    renderCount(stats.total, stats.bot, formatUpdatedAt(stats.updatedAt));
    lastTotalCount = stats.total;
    totalElement.setAttribute("data-discord-count-status", "ok");
    breakdownElement.setAttribute("data-discord-count-status", "ok");
  }

  function renderUnavailable() {
    if (exactTotalCount !== null) {
      updateCount(exactTotalCount, botCount);
      return;
    }

    totalElement.textContent = "現在の合計参加人数：取得できませんでした";
    breakdownElement.textContent = "Bot：" + botCount + "人・人間：取得できませんでした";
  }

  function fetchStats() {
    var endpoints = [
      "./bot-count.json",
      "https://discord.com/api/v10/invites/" + encodeURIComponent(inviteCode) + "?with_counts=true"
    ];

    endpoints.reduce(function (chain, endpoint) {
      return chain.catch(function () {
        return fetchJson(endpoint);
      });
    }, Promise.reject())
      .then(renderStats)
      .catch(function (err) {
        console.warn("Discord人数取得エラー:", err.message);
        totalElement.setAttribute("data-discord-count-status", "error");
        breakdownElement.setAttribute("data-discord-count-status", "error");
        renderUnavailable();
      });
  }

  // 初回取得
  fetchStats();

  // 定期更新（5分ごと）
  if (shouldAutoUpdate) {
    setInterval(function () {
      fetchStats();
    }, 5 * 60 * 1000);
  }
})();
