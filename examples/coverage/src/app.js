import { greeting } from './greeting.js';

document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
  document.querySelector('[role=status]').textContent = greeting(document.querySelector('input').value);
});
