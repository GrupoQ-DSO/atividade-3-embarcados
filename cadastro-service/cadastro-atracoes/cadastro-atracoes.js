// ==========================
// MICRO SERVIÇO: CADASTRO DE ATRAÇÕES
// ==========================

// Importa dependências
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

// Inicializa app Express
const app = express();
const PORT = 8081; // porta específica para este microserviço

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ==========================
// BANCO DE DADOS
// ==========================
const db = new sqlite3.Database('./atracoes.db', (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados SQLite:', err);
  } else {
    console.log('Conectado ao banco de dados SQLite (atracoes.db)');
  }
});

// Cria tabela de atrações, caso não exista
db.run(`
  CREATE TABLE IF NOT EXISTS atracoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    descricao TEXT,
    capacidade INTEGER NOT NULL,
    tempo_medio INTEGER NOT NULL,
    status TEXT DEFAULT 'Em funcionamento'
  )
`, (err) => {
  if (err) console.error('Erro ao criar tabela:', err);
  else console.log('Tabela "atracoes" pronta.');
});

// ==========================
// ROTAS HTTP
// ==========================

// [GET] /atracoes - retorna todas as atrações
app.get('/atracoes', (req, res) => {
  db.all('SELECT * FROM atracoes', [], (err, rows) => {
    if (err) {
      res.status(500).json({ erro: 'Erro ao consultar atrações.' });
    } else {
      res.status(200).json(rows);
    }
  });
});

// [GET] /atracoes/:id - retorna uma atração específica
app.get('/atracoes/:id', (req, res) => {
  db.get('SELECT * FROM atracoes WHERE id = ?', [req.params.id], (err, row) => {
    if (err) {
      res.status(500).json({ erro: 'Erro ao consultar atração.' });
    } else if (!row) {
      res.status(404).json({ erro: 'Atração não encontrada.' });
    } else {
      res.status(200).json(row);
    }
  });
});

// [POST] /atracoes - cadastra uma nova atração
app.post('/atracoes', (req, res) => {
  const { nome, descricao, capacidade, tempo_medio, status } = req.body;

  if (!nome || !capacidade || !tempo_medio) {
    return res.status(400).json({ erro: 'Campos obrigatórios: nome, capacidade, tempo_medio.' });
  }

  db.run(
    'INSERT INTO atracoes (nome, descricao, capacidade, tempo_medio, status) VALUES (?, ?, ?, ?, ?)',
    [nome, descricao || '', capacidade, tempo_medio, status || 'Em funcionamento'],
    function (err) {
      if (err) {
        res.status(500).json({ erro: 'Erro ao cadastrar atração.' });
      } else {
        res.status(201).json({ mensagem: 'Atração cadastrada com sucesso!', id: this.lastID });
      }
    }
  );
});

// [PATCH] /atracoes/:id - atualiza dados da atração
app.patch('/atracoes/:id', (req, res) => {
  const { nome, descricao, capacidade, tempo_medio, status } = req.body;

  db.run(
    `UPDATE atracoes
     SET nome = COALESCE(?, nome),
         descricao = COALESCE(?, descricao),
         capacidade = COALESCE(?, capacidade),
         tempo_medio = COALESCE(?, tempo_medio),
         status = COALESCE(?, status)
     WHERE id = ?`,
    [nome, descricao, capacidade, tempo_medio, status, req.params.id],
    function (err) {
      if (err) {
        res.status(500).json({ erro: 'Erro ao atualizar atração.' });
      } else if (this.changes === 0) {
        res.status(404).json({ erro: 'Atração não encontrada.' });
      } else {
        res.status(200).json({ mensagem: 'Atração atualizada com sucesso!' });
      }
    }
  );
});

// [DELETE] /atracoes/:id - remove uma atração
app.delete('/atracoes/:id', (req, res) => {
  db.run('DELETE FROM atracoes WHERE id = ?', [req.params.id], function (err) {
    if (err) {
      res.status(500).json({ erro: 'Erro ao remover atração.' });
    } else if (this.changes === 0) {
      res.status(404).json({ erro: 'Atração não encontrada.' });
    } else {
      res.status(200).json({ mensagem: 'Atração removida com sucesso!' });
    }
  });
});

// ==========================
// INICIA SERVIDOR
// ==========================
app.listen(PORT, () => {
  console.log(`Servidor de Cadastro de Atrações rodando na porta ${PORT}`);
});
