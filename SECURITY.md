# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.16.1  | ✓         |
| < 0.9   | ✗         |

## Reporting a Vulnerability

ClaudeWatch reads files from `~/.claude` and can detect secrets inside session transcripts. If you find a security vulnerability — especially one related to secret leakage, path traversal, or IPC exploitation — please report it **privately** rather than opening a public issue.

**Do not** open a public GitHub issue for security vulnerabilities.

### How to report

Email: **hi@mohamedalimay.dev**  
Subject: `[ClaudeWatch Security] <short description>`

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- The ClaudeWatch version affected
- Your contact details if you'd like credit in the fix

### Response timeline

- **Acknowledgement**: within 48 hours
- **Initial assessment**: within 5 business days
- **Fix & disclosure**: coordinated with reporter, typically within 30 days

We follow responsible disclosure: vulnerabilities are patched before public announcement and reporters are credited unless they prefer anonymity.
