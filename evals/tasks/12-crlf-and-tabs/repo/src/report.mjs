export function formatRow(name, amount) {
	return name.padEnd(12) + amount.toFixed(2).padStart(10);
}

export function formatReport(rows) {
	const lines = [];
	lines.push('Name'.padEnd(12) + 'Amount'.padStart(10));
	let sum = 0;
	for (const row of rows) {
		lines.push(formatRow(row.name, row.amount));
		sum += row.amount;
	}
	lines.push('Sum'.padEnd(12) + sum.toFixed(2).padStart(10));
	return lines.join('\n');
}
