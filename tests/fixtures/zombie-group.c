#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>

int main(void) {
  pid_t child = fork();
  if (child < 0) return 1;
  if (child == 0) {
    if (setpgid(0, 0) != 0) _exit(2);
    _exit(0);
  }
  siginfo_t info;
  if (waitid(P_PID, child, &info, WEXITED | WNOWAIT) != 0) return 3;
  printf("%d\n", child);
  fflush(stdout);
  // Keep the exited child's group observable until the test releases it.
  char release;
  read(STDIN_FILENO, &release, 1);
  waitpid(child, NULL, 0);
  return 0;
}
