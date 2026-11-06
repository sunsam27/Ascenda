import { buildNotification } from './mailer.service';

it('escapes announcement text in email HTML without changing the plain text', () => {
  const result = buildNotification({ to: 'test@example.invalid', name: '<Admin>', title: '<script>title</script>',
    body: '<img src=x onerror=alert(1)>\nNext line', link: '/documents', appUrl: 'https://app.example.test' });
  expect(result.html).not.toContain('<script>');
  expect(result.html).not.toContain('<img src=x');
  expect(result.html).toContain('&lt;img');
  expect(result.html).toContain('<br>Next line');
  expect(result.text).toContain('<img src=x');
});
