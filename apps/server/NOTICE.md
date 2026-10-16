# Third-party attribution

The private Chrome DevTools Protocol pipe framing in `src/pocket-browser.ts` is adapted from Tanner Middleton’s pi-pocket, fixed at `de612d5622cd`, under the MIT License. The protocol client is changed to validate bounded messages, own its process and apply Pakka resource/operation checks. The original copyright and license are included unchanged in `LICENSE.pi-pocket`.

No pi-pocket Harness, Durable runtime, subagent scheduler or PiP authority is loaded by this package.
