# The Semantic Hologram Protocol (Technical Specification)

## 1. Overview
The Semantic Hologram Protocol is a decentralized framework for the storage, exchange, and live collaboration of typed-edge knowledge graphs. It prioritizes user sovereignty, idiosyncratic ontologies, and asynchronous discovery over centralized standardization.

## 2. The Persistence Layer (The Archive)
- **Format:** Plain Markdown files stored in a directory structure (`hologram/`).
- **Transport:** Git repositories (Public or Private).
- **Interoperability:** Each hologram directory contains a `.data.json` manifest. This manifest defines the local ontology (node types, relationship families, and weights), allowing external plugins to translate the graph into the receiver's local schema.
- **Linking:** Remote nodes are referenced via absolute HTTPS/SSH hyperlinks, creating a "Web of Intuition" where vaults can emulsify remote content as read-only nodes.

## 3. The Communication Layer (The Pulse)
- **Live Transport:** A hybrid approach utilizing `libp2p` for embedded P2P mesh networking and `NATS` for structured federation.
- **P2P Mesh:** Plugins act as nodes in an ad-hoc mesh, exchanging live state (camera position, cursor location) via Gossipsub.
- **Federated Hubs:** NATS servers act as persistent "meeting points" or "club hubs," enabling cross-repo event routing and high-signal collaboration channels.
- **Network Security:** Hubs are hosted as Tor hidden services (`.onion`), with access managed via Tor client authorization.

## 4. Shared World-Space (The Session)
- **Camera State:** Live broadcasting of `azimuth`, `elevation`, `target`, and `standoff` allows users to share their vantage point.
- **Glomming:** A handshake protocol allowing a user to snap their camera to another's orientation for guided tours.
- **Attention Signals:** Real-time cursor projection from world-space to screen-space for precise focus.
- **Event-Driven Interaction:** Changes are transmitted as events (`node.moved`, `relation.created`) rather than raw state dumps, preserving bandwidth and local autonomy.

## 5. Licensing & Governance
- **Code:** GPLv3 (ensuring the protocol remains open and free).
- **Content:** CC-BY-SA 4.0 (ensuring knowledge is shareable but protected against enclosure).

## To Do: Outstanding Technical Challenges
- **Cryptographic Authorship & Identity:** Develop Ed25519 signing mechanisms for node/relation provenance.
- **Offline Caching & Graceful Degradation:** Implement local, read-only caching for remote nodes with offline-state indicators.
- **Publishing Hygiene (The Public/Private Seam):** Create a staging/scrubbing command to prevent accidental leaks of private vault drafts when publishing to Git.
- **Trust, Pollution, and Anti-Spam (Mesh Reputation):** Implement a Web of Trust (WoT) or cryptographic ring to filter remote events.
