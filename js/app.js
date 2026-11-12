const generateBtn = document.getElementById("generateBtn");
const results = document.getElementById("results");

generateBtn.addEventListener("click", generateMenu);

function generateMenu() {

    const budget =
        document.getElementById("budget").value;

    const meals =
        document.getElementById("meals").value;

    const people =
        document.getElementById("people").value;

    results.innerHTML = `
        <h3>Menu généré ✅</h3>

        <p><strong>Budget :</strong> ${budget} €</p>

        <p><strong>Repas :</strong> ${meals}</p>

        <p><strong>Personnes :</strong> ${people}</p>

        <br>

        <p>Le moteur de génération sera ajouté à l'étape suivante.</p>
    `;
}
