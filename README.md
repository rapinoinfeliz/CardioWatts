# CardioWatts 🚲⚡

**CardioWatts** é uma plataforma avançada de treinamento de ciclismo baseada em Heart Rate (FC). Diferente dos aplicativos tradicionais que focam apenas em manter uma potência fixa (Modo ERG), o CardioWatts utiliza algoritmos de controle de última geração para ajustar a intensidade do seu treino com base na sua **resposta fisiológica real**.

---

## 🧠 Algoritmos de Controle (The Engine)

O projeto evoluiu por 5 gerações de algoritmos, cada um elevando a precisão do controle:

### 1. SoftGlide (V1)
Um controlador reativo básico. Ele ajusta a potência baseando-se no erro atual do batimento cardíaco. É ideal para treinos regenerativos onde a suavidade é mais importante que a velocidade de resposta.

### 2. Agility V2 (Projected)
Introduce a lógica de **predição linear**. Em vez de olhar para o agora, ele calcula a tendência (Slope) dos últimos 15 segundos e projeta onde seu batimento estará. Se a projeção ultrapassar o alvo, ele freia preventivamente.

### 3. Bio-MPC V3 (Predictive)
O primeiro salto para o **Model Predictive Control (MPC)**. 
- **Modelo Interno**: Possui um "Digital Twin" do atleta baseado em equações diferenciais.
- **Horizonte de 45s**: Simula 11 futuros possíveis a cada 2 segundos.
- **Otimização**: Escolhe o caminho que chega ao alvo com zero overshoot.

### 4. Bio-MPC V4 (The Mastermind)
Refinamento cirúrgico da fisiologia:
- **Histerese Fisiológica**: Reconhece que o coração acelera mais rápido (Rise) do que desacelera (Fall).
- **Filtro de Kalman**: Estima o "Estado Oculto" da demanda metabólica, ignorando ruídos do sensor de FC.
- **Precisão de 1W**: Otimizador *Hill-Climbing* busca o ajuste exato para máximo conforto.

### 5. Bio-MPC V5 (Stochastic Oracle) 👑
O estado da arte em controle robusto:
- **Simulação Monte Carlo**: Roda 20 simulações paralelas com 10% de ruído aleatório.
- **Segurança p95**: Só aumenta a potência se for seguro em 95% dos "futuros prováveis".
- **Resiliência**: Perfeito para treinos em condições adversas ou com sensores instáveis.

---

## 🔬 O Simulador (Physio Engine)

Para validar esses algoritmos, o CardioWatts possui um simulador integrado de alta fidelidade:

### Modelo de 2ª Ordem (ODE)
Inspirado em pesquisas da Apple Health e fisiologia do esporte, o simulador utiliza um sistema de duas etapas:
1.  **Potência → Demanda Metabólica**: Atraso de ~20s ($\tau_{demand}$).
2.  **Demanda → Frequência Cardíaca**: Atraso de ~30s ($\tau_{hr}$) com termos de saturação não-linear e **Cardiac Drift** (aumenta 0.2bpm/min se a carga for alta).

### Speed Control ⏩
Você pode acelerar o tempo da simulação em **2x, 4x ou 8x**. 
- O app acelera não apenas o gráfico, mas toda a física e a lógica dos algoritmos sincronizadamente. Um treino de 45 minutos pode ser testado em apenas 5 minutos.

---

## 🚀 Como Usar

1.  **Conexão**: Clique em `TRAINER` e `HRM` para conectar seus dispositivos via Bluetooth (ou use o `SIMULATOR`).
2.  **Seleção**: Escolha o algoritmo no menu suspenso (recomendamos o **Bio-MPC V5** para máxima precisão).
3.  **Alvo**: Defina seu `Target HR` e clique em **START**.
4.  **Ajuste**: Se sentir que o app está subestimando seu condicionamento, aumente o alvo ou use a ferramenta de calibração.

---

## 🛠️ Tecnologias
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+).
- **Gráficos**: Chart.js com otimização para streaming de dados.
- **Comunicação**: Web Bluetooth API.
- **Matemática**: Algoritmos de controle preditivo, filtros de Kalman e simulações Monte Carlo.

---

*Desenvolvido para ciclistas que buscam a perfeição metabólica.*
