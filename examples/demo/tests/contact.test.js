import { describe, test } from 'dyno';

describe('Contacts', () => {
  test('saves a contact name', async ({ app, I }) => {
    await app.goto('/');
    await I.type('Robert').into('$(input[name=name])');
    await I.click('Save');
    await I.find('$([role=status])').text('Saved Robert · 1');
  });

  test('starts the next test with a fresh application', async ({ app, I }) => {
    await app.goto('/');
    await I.find('$(input[name=name])').value('');
    await I.find('$([role=status])').text('Ready');
  });
});
