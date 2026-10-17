# DeployMate Security Notes

**Last updated:** 17 October 2026  
**Current security boundary:** Read-only discovery; package scripts are not executed.

## Current behavior

DeployMate reads repository/package metadata, records recognized script declarations, and prints a report. Available commands are marked `Execution status: NOT RUN`.

This separation is intentional. A script declaration is untrusted input, not authorization to execute a command.

## Threat model: repository scripts

Package scripts can run arbitrary code. Depending on permissions and environment, a command may:
- Read or modify files.
- Access environment variables or credentials.
- Launch subprocesses.
- Use network connections.
- Consume excessive CPU, memory, or disk.
- Attempt to affect the host environment.

Do not automatically run every script found in a repository.

## Planned safeguards before executing untrusted scripts

1. **Explicit execution policy:** Run only selected checks permitted by policy.
2. **Isolation:** Use a container-based execution backend initially, subject to configuration and testing.
3. **Working-directory validation:** Confirm the intended component and repository paths.
4. **Timeouts:** Stop checks that exceed configured time limits.
5. **Resource controls:** Apply practical CPU, memory, and process limits.
6. **Network restrictions:** Disable or restrict network access where practical.
7. **Credential protection:** Do not pass host secrets or unnecessary environment variables into the execution environment.
8. **Filesystem restrictions:** Mount only required project files; restrict write access where practical.
9. **Output capture:** Record stdout, stderr, exit code, duration, and execution errors.
10. **Accurate reporting:** Distinguish passed, failed, timed out, blocked, skipped, and not run.
11. **Review before repair:** Keep proposed code changes reviewable and require approval before applying repairs.

## Docker caveat

Docker can reduce risk by isolating processes, but a container is not automatically a complete security boundary. Security depends on runtime configuration, mounted directories, privileges, network access, secrets, resource limits, and host setup.

Do not mount sensitive host directories or expose credentials to an untrusted container. Avoid privileged containers. Verify the actual isolation settings rather than assuming the defaults meet every requirement.

## Planned next session

- Install and verify Docker Desktop on Windows, using WSL 2 if supported.
- Design a replaceable execution interface and structured result model.
- Test result handling with mocked processes.
- Integrate real command execution only after the safety policy and isolation approach are established.

## Current limitations

The execution engine and Docker integration are not implemented or verified yet. The current discovery-only workflow does not establish whether a project is safe, correct, or release-ready.
