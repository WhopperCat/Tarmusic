(function () {
  const button = document.getElementById('info-button');
  const modal = document.getElementById('info-modal');
  if (!button || !modal) return;

  function open() {
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  button.addEventListener('click', open);

  modal.addEventListener('click', function (e) {
    if (e.target.matches('[data-close]')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') close();
  });
})();
