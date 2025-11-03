// Inicia o Express.js
const express = require("express");
const app = express();

// Body Parser - usado para processar dados da requisição HTTP
const bodyParser = require("body-parser");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Importa o package do SQLite
const sqlite3 = require("sqlite3");

const axios = require("axios");

const API_GATEWAY_URL = "http://localhost:8000";

// Acessa o arquivo com o banco de dados
var db = new sqlite3.Database("./Ingressos.db", (err) => {
  if (err) {
    console.log("ERRO: não foi possível conectar ao SQLite 'Ingressos.db'.");
    throw err;
  }
  console.log("Conectado ao SQLite 'Ingressos.db'!");
});

// Cria a tabela ingressos, caso ela não exista
db.run(
  `CREATE TABLE IF NOT EXISTS ingressos (
        id TEXT PRIMARY KEY,
        cpf_usuario INTEGER NOT NULL,
        tipo TEXT NOT NULL CHECK(tipo IN ('limitado', 'diario', 'anual')),
        criado_em TEXT NOT NULL,
        valido_ate TEXT,
        acessos_restantes INTEGER
    );`,
  [],
  (err) => {
    if (err) {
      console.log("ERRO: não foi possível criar tabela 'ingressos'.");
      throw err;
    }
  }
);

/**
 * Método HTTP POST /Ingressos - "Vende" (cria) um novo ingresso
 * Body: { "cpf": 12345678900, "tipo": "limitado", "valorInicial": 5 }
 */
app.post("/Ingressos", (req, res, next) => {
  const { cpf, tipo, valorInicial } = req.body;

  if (!cpf || !tipo) {
    return res.status(400).send("CPF e tipo são obrigatórios.");
  }

  // Antes de criar o ingresso, verifica se o usuário existe
  // no microserviço de Cadastro (através do Gateway).
  axios
    .get(`${API_GATEWAY_URL}/Cadastro/${cpf}`)
    .then((response) => {
      // Se o Gateway retornou 200, o usuário existe.
      console.log(`Usuário ${cpf} verificado via Gateway. Criando ingresso...`);

      // Lógica para definir os dados do ingresso
      const now = new Date();
      const id = `TICKET-${Date.now()}`;
      const criadoEm = now.toISOString();

      let validoAte = null;
      let acessosRestantes = null;

      switch (tipo) {
        case "limitado":
          const valorNumerico = parseInt(valorInicial, 10);

          if (!valorNumerico || isNaN(valorNumerico) || valorNumerico <= 0) {
            return res
              .status(400)
              .send("Tipo 'limitado' exige 'valorInicial' numérico positivo.");
          }

          acessosRestantes = valorNumerico;
          break;
        case "diario":
          const dataExpiracaoDiario = new Date(now);
          dataExpiracaoDiario.setDate(dataExpiracaoDiario.getDate() + 1);
          validoAte = dataExpiracaoDiario.toISOString();
          break;
        case "anual":
          const future = new Date(now);
          future.setDate(future.getDate() + 365); // Válido por 365 dias
          validoAte = future.toISOString();
          break;
        default:
          return res
            .status(400)
            .send(
              "Tipo de ingresso inválido. Use 'limitado', 'diario' ou 'anual'."
            );
      }

      // 3. Inserir o ingresso no banco de dados 'Ingressos.db'
      const params = [id, cpf, tipo, criadoEm, validoAte, acessosRestantes];
      db.run(
        "INSERT INTO ingressos (id, cpf_usuario, tipo, criado_em, valido_ate, acessos_restantes) VALUES (?, ?, ?, ?, ?, ?)",
        params,
        function (err) {
          if (err) {
            console.log("Erro ao criar ingresso: " + err);
            return res.status(500).send("Erro ao criar o ingresso.");
          }
          // Retorna o ingresso recém-criado
          db.get("SELECT * FROM ingressos WHERE id = ?", [id], (err, row) => {
            if (err) {
              return res
                .status(500)
                .send("Ingresso criado, mas falha ao buscá-lo.");
            }
            res.status(201).json(row);
          });
        }
      );
    })
    .catch((error) => {
      // Se o Axios der erro (ex: Gateway não achou o usuário)
      if (error.response && error.response.status === 404) {
        return res
          .status(404)
          .send("Usuário (CPF) não encontrado (verificado via Gateway).");
      } else {
        // Outro erro (ex: Gateway fora do ar)
        console.log("Erro ao contatar Gateway:", error.message);
        return res
          .status(500)
          .send("Erro ao verificar usuário via API Gateway.");
      }
    });
});

/**
 * Método HTTP POST /Validar/:id - Valida um ingresso na catraca
 * Esta rota será chamada pela catraca (via Gateway)
 */
app.post("/Validar/:id", (req, res, next) => {
  const { id } = req.params;
  const now_iso = new Date().toISOString();

  // 1. Busca o ingresso no banco local 'Ingressos.db'
  db.get("SELECT * FROM ingressos WHERE id = ?", [id], (err, ticket) => {
    if (err) {
      return res.status(500).send("Erro ao consultar ingresso.");
    }
    if (!ticket) {
      // Ingresso não existe
      return res
        .status(404)
        .json({ allowed: false, message: "Ingresso não encontrado." });
    }

    // 2. Lógica de validação por tipo
    let validationResponse = {
      allowed: false,
      message: "",
      cpf: ticket.cpf_usuario, // Informa o CPF para o serviço de filas
    };

    switch (ticket.tipo) {
      case "limitado":
        if (ticket.acessos_restantes > 0) {
          const novosAcessos = ticket.acessos_restantes - 1;
          // Atualiza o banco ANTES de liberar
          db.run(
            "UPDATE ingressos SET acessos_restantes = ? WHERE id = ?",
            [novosAcessos, id],
            (updateErr) => {
              if (updateErr) {
                return res
                  .status(500)
                  .send("Erro ao atualizar acessos do ingresso.");
              }

              validationResponse.allowed = true;
              validationResponse.message = `Acesso permitido. Restam ${novosAcessos} acessos.`;

              // DICA: Aqui você usaria o Axios para chamar o serviço de FILAS
              // axios.post(`${API_GATEWAY_URL}/filas/entrar`, { cpf: ticket.cpf_usuario, ... })

              res.status(200).json(validationResponse);
            }
          );
          // Retorno é assíncrono, então saímos da função
          return;
        } else {
          validationResponse.message = "Ingresso sem acessos restantes.";
          res.status(403).json(validationResponse); // 403 = Forbidden
        }
        break;

      case "diario":
        if (now_iso <= ticket.valido_ate) {
          validationResponse.allowed = true;
          validationResponse.message = "Acesso ilimitado (diário) permitido.";
          // DICA: Chamar serviço de FILAS aqui
          res.status(200).json(validationResponse);
        } else {
          validationResponse.message = "Ingresso diário expirado.";
          res.status(403).json(validationResponse);
        }
        break;

      case "anual":
        if (now_iso <= ticket.valido_ate) {
          validationResponse.allowed = true;
          validationResponse.message = "Acesso (passaporte anual) permitido.";
          // DICA: Chamar serviço de FILAS aqui
          res.status(200).json(validationResponse);
        } else {
          validationResponse.message = "Passaporte anual expirado.";
          res.status(403).json(validationResponse);
        }
        break;
    }
  });
});

/**
 * Método HTTP GET /Ingressos - retorna todos os ingressos (para admin)
 */
app.get("/Ingressos", (req, res, next) => {
  db.all(`SELECT * FROM ingressos`, [], (err, result) => {
    if (err) {
      res.status(500).send("Erro ao obter dados.");
    } else {
      res.status(200).json(result);
    }
  });
});

/**
 * Método HTTP GET /Ingressos/usuario/:cpf - retorna todos os ingressos de um usuário
 */
app.get("/Ingressos/usuario/:cpf", (req, res, next) => {
  db.all(
    `SELECT * FROM ingressos WHERE cpf_usuario = ?`,
    req.params.cpf,
    (err, result) => {
      if (err) {
        res.status(500).send("Erro ao obter dados.");
      } else {
        // Retorna a lista (pode ser vazia se não houver ingressos)
        res.status(200).json(result);
      }
    }
  );
});

/**
 * Método HTTP GET /Ingressos/:id - retorna um ingresso específico
 */
app.get("/Ingressos/:id", (req, res, next) => {
  db.get(
    `SELECT * FROM ingressos WHERE id = ?`,
    req.params.id,
    (err, result) => {
      if (err) {
        res.status(500).send("Erro ao obter dados.");
      } else if (result == null) {
        res.status(404).send("Ingresso não encontrado.");
      } else {
        res.status(200).json(result);
      }
    }
  );
});

// Inicia o Servidor na porta 8081
// Esta porta DEVE ser diferente do serviço de Cadastro
let porta = 8081;
app.listen(porta, () => {
  console.log(`Microserviço de INGRESSOS em execução na porta: ${porta}`);
});
