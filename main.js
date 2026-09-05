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

  var shouldAutoUpdate = totalElement.getAttribute("data-auto-count") === "true";
  var inviteCode = totalElement.getAttribute("data-invite-code") || "a26JJr3hVz";
  var snapshotMaxAgeMs = 60 * 60 * 1000;
  var requestTimeoutMs = 10 * 1000;
  var lastStats = null;
  var inFlight = false;

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

  function isCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function parseUpdatedAt(value) {
    if (typeof value !== "string" || !value) {
      return null;
    }

    var date = new Date(value);
    return Number.isFinite(date.getTime()) && date.getTime() <= Date.now() ? date : null;
  }

  function normalizeSnapshot(data) {
    if (!data || !isCount(data.total) || !isCount(data.bot) || !isCount(data.human) ||
        data.total !== data.bot + data.human) {
      throw new Error("Discordの人数データが不正です");
    }

    return {
      total: data.total,
      bot: data.bot,
      human: data.human,
      approximate: false,
      updatedAt: parseUpdatedAt(data.updatedAt)
    };
  }

  function normalizeInvite(data) {
    if (!data || !isCount(data.approximate_member_count)) {
      throw new Error("Discordの概数取得結果が不正です");
    }

    return {
      total: data.approximate_member_count,
      approximate: true,
      updatedAt: new Date()
    };
  }

  function fetchJson(url) {
    var controller = new AbortController();
    var timeout = setTimeout(function () {
      controller.abort();
    }, requestTimeoutMs);

    return fetch(url, { cache: "no-store", signal: controller.signal })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Discordの人数取得に失敗しました (status: " + response.status + ")");
        }

        return response.json();
      })
      .then(function (data) {
        clearTimeout(timeout);
        return data;
      }, function (error) {
        clearTimeout(timeout);
        throw error;
      });
  }

  function renderStats(stats, stale) {
    var timeLabel = stats.updatedAt ? formatUpdatedAt(stats.updatedAt) + "確認" : "確認日時不明";
    var prefix = stale ? "最終確認の合計参加人数（Botを含む）：" : "現在の合計参加人数（Botを含む）：";
    var status = stale ? "stale" : stats.approximate ? "approximate" : "ok";

    totalElement.textContent = prefix + (stats.approximate ? "約" : "") + stats.total + "人 (" +
      timeLabel + (stale ? "・更新停止" : "") + ")";
    breakdownElement.textContent = stats.approximate
      ? "Bot・人間の内訳：取得できません（合計は概数）"
      : "Bot：" + stats.bot + "人・人間：" + stats.human + "人";
    totalElement.setAttribute("data-discord-count-status", status);
    breakdownElement.setAttribute("data-discord-count-status", status);
  }

  function renderUnavailable() {
    if (lastStats) {
      renderStats(lastStats, true);
      return;
    }

    totalElement.textContent = "現在の合計参加人数：取得できませんでした";
    breakdownElement.textContent = "Bot・人間の内訳：取得できませんでした";
    totalElement.setAttribute("data-discord-count-status", "error");
    breakdownElement.setAttribute("data-discord-count-status", "error");
  }

  function fetchStats() {
    if (inFlight) {
      return;
    }

    inFlight = true;
    fetchJson("./bot-count.json")
      .then(normalizeSnapshot)
      .then(function (stats) {
        if (!lastStats || (stats.updatedAt && (!lastStats.updatedAt || stats.updatedAt > lastStats.updatedAt))) {
          lastStats = stats;
        }

        if (!stats.updatedAt || Date.now() - stats.updatedAt.getTime() > snapshotMaxAgeMs) {
          throw new Error("Discordの人数データの更新が停止しています");
        }

        return stats;
      })
      .catch(function () {
        return fetchJson("https://discord.com/api/v10/invites/" + encodeURIComponent(inviteCode) + "?with_counts=true")
          .then(normalizeInvite);
      })
      .then(function (stats) {
        lastStats = stats;
        renderStats(stats, false);
      })
      .catch(function (err) {
        console.warn("Discord人数取得エラー:", err.message);
        renderUnavailable();
      })
      .then(function () {
        inFlight = false;
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
