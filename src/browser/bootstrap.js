let root = '/__dyno__/';
let start = document.getElementById('start');
let notice = document.getElementById('start-status');
let companion;
let launch = () => {
  if (companion && !companion.closed) {
    companion.focus();
    return;
  }
  let name = `dyno-controller-${[...crypto.getRandomValues(new Uint32Array(4))].join('-')}`;
  companion = window.open(root + 'controller' + location.search + location.hash, name);
  if (!companion) {
    start.hidden = false;
    notice.textContent =
      'Start opens a companion window to keep your tests running when the app navigates. Keep both windows open.';
    return;
  }
  notice.textContent = 'Connecting tests…';
  start.hidden = true;
  window.focus();
};
start.addEventListener('click', launch);
launch();
