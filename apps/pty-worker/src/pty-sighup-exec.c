#include <signal.h>
#include <unistd.h>
#include <stdio.h>
int main(int argc, char *argv[]) {
    struct sigaction sa;
    sa.sa_handler = SIG_IGN;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;
    sigaction(SIGHUP, &sa, NULL);
    if (argc < 2) {
        fprintf(stderr, "usage: pty-sighup-exec <cmd> [args...]\n");
        return 1;
    }
    execvp(argv[1], argv + 1);
    perror("execvp");
    return 127;
}
