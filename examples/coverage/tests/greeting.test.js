import { describe, test } from 'dyno';

describe('Greeting card', () => {
  test('greets a named visitor', async ({ app, I }) => {
    await app.goto('/');
    await I.type('Robert').into('$(input[name=name])');
    await I.click('Save');
    await I.find('$([role=status])').text('Hello, Robert!');
  });

  test('keeps coverage when the app navigates', async ({ app, I }) => {
    await app.goto('/');
    await I.click('Save');
    await I.find('$([role=status])').text('Please enter a name.');
    await I.click('Open details');
    await I.find('$(h1)').text('Card details');
  });
});
