import { ItemView, WorkspaceLeaf, Setting, Notice } from 'obsidian';
import type SemanticHologramPlugin from './main';
import { auditHologramNodes, repairHologramNode } from './audit';

export const VIEW_TYPE_AUDIT_CONNECTIONS = 'audit-connections-view';

export class AuditConnectionsView extends ItemView {
    constructor(leaf: WorkspaceLeaf, private plugin: SemanticHologramPlugin) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_AUDIT_CONNECTIONS;
    }

    getDisplayText(): string {
        return 'Audit Connections';
    }

    getIcon(): string {
        return 'shield-alert';
    }

    async onOpen(): Promise<void> {
        this.contentEl.addClass('sh-audit-view');

        await this.runAudit();
    }

    private async runAudit(): Promise<void> {
        const results = await auditHologramNodes(this.plugin);

        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h4', { text: 'Audit connections' });
        contentEl.createDiv({ cls: 'sh-audit-results' }, (div) => {
            if (results.length === 0) {
                div.createDiv({ text: 'No issues found.' });
            } else {
                div.createDiv({ text: `Found ${results.length} nodes with issues.` });
                const list = div.createEl('ul');
                for (const r of results) {
                    list.createEl('li', { text: `${r.file.basename}: ${r.issues.join(', ')}` });
                }
                
                new Setting(div).addButton((b) =>
                    b
                        .setButtonText('Fix All')
                        .setCta()
                        .onClick(async () => {
                            for (const res of results) {
                                const content = await this.plugin.app.vault.read(res.file);
                                const fixed = repairHologramNode(content, res.file, this.plugin);
                                await this.plugin.app.vault.modify(res.file, fixed);
                            }
                            new Notice(`Fixed ${results.length} nodes.`);
                            await this.plugin.refreshIncomingRelationships();
                            await this.plugin.refreshGraphs();
                            await this.runAudit(); // Refresh the view
                        }),
                );
            }
        });
    }
}
