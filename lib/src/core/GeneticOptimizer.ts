export interface Chromosome {
    fitness?: number;
}

export interface GeneticModel {
    createChromosome(): Promise<Chromosome>;
    fitness(gene: Chromosome): Promise<number>;
    mutate(gene: Chromosome): Promise<Chromosome>;
    crossover(parent1: Chromosome, parent2: Chromosome): Promise<Chromosome>;
    stopCriteria(optimizer: GeneticOptimizer): boolean;
    chromosomeToString(gene: Chromosome): string;
    populationSize?: number;
    mutateProbability?: number;
    crossoverProbability?: number;
}

export class GeneticOptimizer {

    protected _model: GeneticModel;
    protected _population: Chromosome[];
    protected _pastChromosomes: string[];
    protected _totalFitness: number;
    protected _generation: number;

    constructor(model: GeneticModel) {
        this._model = model;
        this._population = [];
        this._pastChromosomes = [];
        this._totalFitness = 0;
        this._generation = 0;
    }

    public async createPopulation() {
        this._population = [];
        const { populationSize } = this._model;
        for (let i = 0; i < populationSize; i += 1) {
            const chromosome = await this.createUniqueChromosome();
            this._population.push(chromosome);
            this._pastChromosomes.push(this._model.chromosomeToString(chromosome));
        }
    }

    public get generation(): number {
        return this._generation;
    }

    public get maxFitness(): number {
        return this._population[0].fitness;
    }

    protected async createUniqueChromosome(): Promise<Chromosome> {
        let chromosome = null;
        let counter = 0;
        do {
            chromosome = await this._model.createChromosome();
            counter += 1;
        } while (this._pastChromosomes.indexOf(chromosome) >= 0 && counter < 20);
        return chromosome;
    }

    public async iteration() {
        this._generation += 1;
        console.log(`[${new Date().toUTCString()}] Genetic optimizer generation: ${this._generation}.`);
        // compute the fitness of each population member
        const { crossoverProbability, mutateProbability } = this._model;
        this._totalFitness = 0;
        for (const gene of this._population) {
            if (gene.fitness === undefined) {
                gene.fitness = await this._model.fitness(gene);
            }
            this._totalFitness += gene.fitness;
        }
        // sort the population by fitness
        this._population.sort((a, b) => {
            return b.fitness - a.fitness; // descending
        });

        // print out the current best
        console.log(`[${new Date().toUTCString()}] Genetic optimizer best chromosome: ${JSON.stringify(this.getBestChromosome())}.`);

        // create the children
        const children: Chromosome[] = [];
        for (let i = 0; i < this._population.length * crossoverProbability; i += 1) {
            const chromosome1 = this.selectChromosome();
            const chromosome2 = this.selectChromosome();
            let counter = 0;
            let child = null;
            do {
                child = await this._model.crossover(chromosome1, chromosome2);
                if (Math.random() > mutateProbability) {
                    child = await this._model.mutate(child);
                }
                counter += 1;
            } while (this._pastChromosomes.indexOf(child) >= 0 && counter < 20);
            children.push(child);
        }

        // remove the worst performers and add the children for the next generation
        this._population = this._population.slice(0, this._population.length - children.length);
        this._population = this._population.concat(children);
    }

    public async run() {
        // create the population
        await this.createPopulation();
        do {
            await this.iteration();
        } while (!this._model.stopCriteria(this));
    }

    public getBestChromosome(): Chromosome {
        return this._population[0];
    }

    protected selectChromosome() {
        const level = Math.random() * this._totalFitness;
        let sum = 0;
        for (const chromosome of this._population) {
           sum += chromosome.fitness;
           if (sum >= level) {
               return chromosome;
           }
        }
    }
}
