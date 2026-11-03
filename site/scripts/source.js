import ts from 'typescript';

// These tags only connect source copy to a guide or a public declaration.
export function sourceDocs(files) {
  let api = new Map();
  let guides = new Map();
  for (let { path, text } of files) {
    let source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let seen = new Set();
    function visit(node) {
      for (let range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
        if (seen.has(range.pos)) continue;
        seen.add(range.pos);
        let raw = text.slice(range.pos, range.end);
        if (!raw.startsWith('/**')) continue;
        let body = raw.slice(3, -2).split('\n').map(line => line.replace(/^\s*\* ?/, '')).join('\n').trim();
        let tags = [...body.matchAll(/^@(api|guide) (\S+)(?: (.+))?$/gm)];
        if (!tags.length) continue;
        if (tags.length !== 1) throw new Error(`Use one @api or @guide tag per JSDoc block in ${path}.`);
        let [tag] = tags;
        let [, kind, key, title] = tag;
        let collection = kind === 'api' ? api : guides;
        if (collection.has(key)) throw new Error(`Duplicate @${kind} ${key} in ${path}.`);
        collection.set(key, { title, body: body.replace(tag[0], '').replaceAll('*\\/', '*/').trim(), path });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { api, guides };
}

export function documentedTypes(path, text, api, used) {
  // The declarations remain the signature authority; source comments own all copy.
  let source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  let removals = [];
  let seen = new Set();
  function comments(node) {
    for (let range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      removals.push(range);
    }
    ts.forEachChild(node, comments);
  }
  comments(source);
  for (let { pos, end } of removals.sort((a, b) => b.pos - a.pos)) text = text.slice(0, pos) + text.slice(end);
  source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  let insertions = [];
  for (let statement of source.statements) {
    let exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    let declaration = ts.isVariableStatement(statement) ? statement.declarationList.declarations[0] : statement;
    let name = declaration.name?.getText(source);
    if (!name) continue;
    if (!exported) {
      insertions.push({ pos: statement.getStart(source), body: '@internal' });
      continue;
    }
    let doc = api.get(name);
    if (!doc) throw new Error(`Public declaration ${name} in ${path} needs source JSDoc with @api ${name}.`);
    used.add(name);
    let target = ts.isInterfaceDeclaration(declaration)
      ? declaration.members.find(ts.isCallSignatureDeclaration) ?? statement
      : statement;
    insertions.push({ pos: target.getStart(source), body: doc.body });
    for (let member of declaration.members ?? []) {
      let key = `${name}.${member.name?.getText(source)}`;
      if (!api.has(key)) {
        if (['Application', 'NativeBrowser'].includes(name)) throw new Error(`Public member ${key} needs source JSDoc.`);
        continue;
      }
      used.add(key);
      insertions.push({ pos: member.getStart(source), body: api.get(key).body });
    }
  }
  for (let { pos, body } of insertions.sort((a, b) => b.pos - a.pos)) {
    let comment = `/**\n${body.split('\n').map(line => ` * ${line}`).join('\n')}\n */\n`;
    text = text.slice(0, pos) + comment + text.slice(pos);
  }
  return text;
}
