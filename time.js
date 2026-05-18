(function () {
  function formatTime(date) {
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    var seconds = String(date.getSeconds()).padStart(2, "0");

    return hours + ":" + minutes + ":" + seconds;
  }

  function startClock() {
    var textElement = document.getElementById("text");

    if (!textElement) {
      return;
    }

    function updateTime() {
      textElement.textContent = formatTime(new Date());
    }

    updateTime();
    window.setInterval(updateTime, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startClock);
  } else {
    startClock();
  }
})();
