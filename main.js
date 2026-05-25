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
  var inviteCode = "a26JJr3hVz";
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
  var discordApiUrl = "https://discord.com/api/v10/invites/" + inviteCode + "?with_counts=true&with_expiration=true";
  var countApiUrl = "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(discordApiUrl);

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

  function calculateHumanCount(totalCount) {
    return Math.max(totalCount - botCount - humanSubtract, 0);
  }

  function renderCount(totalCount, updatedAt) {
    var humanCount = calculateHumanCount(totalCount);
    // 合計表示は内訳と必ず一致させるため、API取得値ではなくBot数+人間数で表示する。
    var displayTotal = botCount + humanCount;
    var totalSubtract = Math.max(totalCount - displayTotal, 0);
    totalElement.setAttribute("data-subtract", String(totalSubtract));

    totalElement.textContent = "現在の合計参加人数：" + displayTotal + "人 (" + updatedAt + "更新)";
    breakdownElement.textContent = "Bot：" + botCount + "人・人間：" + humanCount + "人";
  }

  function updateCount(totalCount) {
    renderCount(totalCount, formatUpdatedAt(new Date()));
  }

  if (exactTotalCount !== null) {
    renderCount(exactTotalCount, formatUpdatedAt(new Date()));
    return;
  }

  if (!shouldAutoUpdate) {
    return;
  }

  fetch(countApiUrl, { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("Discordの人数取得に失敗しました");
      }
      return response.json();
    })
    .then(function (data) {
      var totalCount = Number(data.approximate_member_count || data.profile && data.profile.member_count);

      if (!Number.isFinite(totalCount)) {
        throw new Error("Discordの人数取得結果が不正です");
      }

      updateCount(totalCount);
    })
    .catch(function () {
      totalElement.setAttribute("data-discord-count-status", "fallback");
      breakdownElement.setAttribute("data-discord-count-status", "fallback");
    });
})();
