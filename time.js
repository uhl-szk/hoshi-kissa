<body>
  <span id="text">現在時刻</span>

  <script type="text/javascript">
  document.getElementById("text").innerHTML = showTime();
  
  function showTime() {
    var now = new Date();
    var nowhour = now.getHours();
    var nowminutes = now.getMinutes();
    var nowseconds = now.getSeconds();
  
    var text = nowhour + "：" + nowminutes + "：" + nowseconds; 
    
    return text;
  }
  </script>
  </body>
