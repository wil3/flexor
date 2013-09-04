/**
  * Copyright 2012 William Koch
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *  http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
 */

var koch = {};

(function(){
	
	
	/**
	 * The ARM
	 */
	var ARM = function(oConfig){
		this._oMemory = oConfig.memory;	
		this.init();
	}
	
	/**
	 * Static properties
	 */
	ARM.CLK_FREQ = 1000;
	ARM.WORD_SIZE = 16; // Number of bits in a word, thumb = 16;
	//ARM.R_ADDR = 12; //Addres Register
	ARM.R_SP = 13; //Stack pointer
	ARM.R_LR = 14; //Link Register
	ARM.R_PC = 15;
	
	ARM.NUM_REG = 16;
	
	//TODO add priorities
	ARM.VECTOR_TABLE = {
			reset: 	0,
			undef: 	4,
			swi:	8,
			pabort:	12,
			dabort: 16,
			reserved: 20,
			irq: 24,
			fiq: 28		
	}

	ARM.NUM_PIPE_STAGES = 3;
	/**
	 * Number of bits in a thumb word
	 */
	ARM.THUMB_WORD_SIZE = 16;
	
	ARM.prototype = {
			/**
			 * Reference to attached memory
			 */
			_oMemory: null,
			/**
			 * Current Program Status Register
			 * A2.5 ARM reference manual
			 * T bit, bit[5], if T==0, 
			 * 32 bit instruction fetched, PC+=4
			 * if T==1, 16 bit isntruction fetch PC+=2
			 */
			_bCPSR: 0,
			
			/**
			 * Register values
			 */
			//TODO Add restriction to R0 to R7
			_aRegisters: [],
			/**
			 * address register
			 */
			_a: 0x00000000,
			/**
			 * Data-in Register
			 */
			_di: 0x0,
			
			/**
			 * Data-out Register
			 */
			_do: 0x0,
			
			/**
			 * Instruction put in pipeline
			 */
			_wInstruction: 0x00000000,
			
			/**
			 * ALU Bus
			 */
			_wALUBus: 0x00000000,
			
			/**
			 * A Bus
			 */
			_wABus: 0x00000000,
			/**
			 * B Bus
			 */
			_wBBus: 0x00000000,
			/**
			 * PC Bus
			 */
			_wPcBus: 0x00000000,
			/**
			 * Address register Bus
			 */
			_wAddrBus: 0x00000000,
			/**
			 * Incrementer Bus
			 */
			_wIncBus: 0x00000000,
			/**
			 * Used to store instruction pipeline between fetch and decode stage
			 */
			_pInstruction: 0x00,
			/**
			 * Flag indicating state of clock, high|low
			 */
			_fClkHigh: false,
			
			/**
			 * Clock subscribers
			 */
			_oClkListeners: {
				"rising": [],
				"high": [],
				"falling":[],
				"low":[]
				
			},
			_sException: null,
			
			/**
			 * Pipeline signals, cache for a clock cycle so they can be added to the
			 * signal queue before execution
			 */
			_pSignals:[],
			
			/**
			 * The queue of signals to set before execution stage
			 * This should be an array of objects, each object should specifiy if it needs to access memory
			 */
			_qSignals: [],
			/**
			 *
			 * The state of all signals for each element
			 */
			//FIXME Tie these signals to each processor element. Each element should be an object. 
			_signals: {
				mem: {
					fWrite:false
				},
				addr: {
					fWrite:false,
					bIn: 0x0, // 1=ALU, 2=Exception vector, 3=PC
					bOut: 0x0 //0=address bus, 1=inc bus
				},
				inc: {
					fEnable: false,
				},
				reg: {
					
					/**
					 * When signal is high write value on bus to Data Address
					 */
					fWrite:false,
					/**
					 * One write port for all registers but PC
					 */
					bDataAddress:0x00,
					/**
					 * Select which register to put on A bus
					 */
					bAddressA: 0x00,
					/**
					 * Select which register to put on B bus
					 */
					bAddressB: 0x00
				},
				alu: {
					fEnable: false,
					bFn: 0x00,//[6...0]
					fV: false,
					fCin: false,
					fCout: false
				},
				mul: {
					bIn1: 0x00000000,
					bIn2: 0x00000000,
					bIn3: 0x00000000,
					fIn: false,
					fStart: false,
					fAccum: false
				},
				shift: {
					bIn: 0x00000000,
					bVal: 0x00,//[5...0]
					fCin: false,
					fCout: false,
					fType: false
				}
			},
			/**
			 * Initialize the processor
			 */
			//TODO rename to reset?
			init: function(){
				//TODO Come up with a better way to initialize all the variables
				this._a =  0x00000000;
				
				//Initialize all register values to 0
				var l = ARM.NUM_REG;
				while(l--) this._aRegisters.push(0);

				
				//Set the clock subscribers and then start the clock
	
				this.addClkListener("rising", this._addrReg);
				this.addClkListener("high", this._addrReg);
				this.addClkListener("falling", this._addrReg);
				this.addClkListener("low", this._addrReg);

				this.addClkListener("rising", this._inc);
				this.addClkListener("falling", this._inc);

				this.addClkListener("rising", this._regfile);
				this.addClkListener("high", this._regfile);
				this.addClkListener("falling", this._regfile);
				this.addClkListener("low", this._regfile);
				
				this.addClkListener("rising", this._control);
				this.addClkListener("falling", this._control);

				
			},			
			/**
			 * Start the processor
			 */
			start: function(){
				
				this.init();
				//MUX indicate size of address to fetch
				 //var instructionSize = (this._bCPSR & 0x0020 == 1) ? 2 : 4;
				
				 //this._startClk();	 	
			},
			exception: function(){
				
			},
			_handleException: function(){
				/**
				 * armv5 2.6
				 * R14_<exception_mode> = return link
				 * SPSR_<exception_mode> = CPSR
				 * CPSR[4:0] = mode #
				 * CPSR[5] = 0
				 * if <exception_mode> == Reset or FIQ then
				 * CPSR[6] = 1
				 * 
				 * CPSR[7] = 1
				 * PC = vector address
				 */
			},
			/**
			 * Pluse the clock and simulate rising and falling of clock
			 */
			pluseClk: function(){
				//two phases
				this._pluseClkPhase()
				var nop;
				this._pluseClkPhase()

			
			},
			/**
			 * Clock phases, rising edge and falling edge
			 * 
			 */
			_pluseClkPhase: function(){
				
				//setTimeout(function(){
					var aStates = [];

					//Toggle and set states to execute
					if (this._fClkHigh){
						aStates = ["falling", "low"];
						this._fClkHigh = false;
					} else {
						aStates = ["rising", "high"];
						this._fClkHigh = true;
					}
					
					//Call the subscribers
					for (var i=0; i<aStates.length; i++){
						var stopPropegation = false;
						var aSubscribers = this._oClkListeners[aStates[i]];
						if (aSubscribers.lenght > 1){aSubscribers = aSubscribers.reverse()}; //reverse so when we pop it will be fifo
						for (var j=0; j<aSubscribers.length;j++){
							
							//TODO
							//Must add stop propigation handler
							aSubscribers[j].apply(this,[aStates[i]]);
							
						}
						
					}		
				
					//TODO
					//Check for interrupts
					if (this._sException != null){
						
					} 
					
			//	},ARM.CLK_FREQ/2);
				
			},
			/**
			 * Clock
			 */
			_clkSubscription: function(){
				
				/*
				 * separate pipeline elements that must be executed in order from elements that can be access all the time that 
				 * are triggered by clock signals (ie registers and memory)
				 */
				var obj = {
						signals: {},
						stopPropagation: false,
						flush: false,
						repeat: false
				
				}	
			},
			addClkListener: function(sEv, fnSubscriber){
				//if sEv is ok
				this._oClkListeners[sEv].push(fnSubscriber);
			},
			
			/**
			 * Controller: determine when to execute pipeline stages and when to 
			 * @param e
			 */
			_control: function(e){
				
				/*
				 * If the signal queue is larger than then number of pipeline
				 * stages then it means that a str|ldr instruction has been decoded
				 * and added thus the decode stage cant execute yet because the datapath
				 * is owned by the execution stage so stall untill the execution is done
				 */
				if (this._qSignals.length <= ARM.NUM_PIPE_STAGES){ 
					//FIXME only decode should be stalled
					this._fetch(e);
					this._decode(e);
				} 
				
				/*
				 * We want to set the signals before execution phase but this will 
				 * be the signals set from the last decode. The signals are stored in 
				 * a FIFO queue
				 */
				if (this._qSignals.length > 0 ){
					this._qSignals[0].apply(this,[e])
				}
				
				//mul
				//shift
				this._alu(e);
				
			},
			
			_fetch: function(e){
				
				if (e == "rising"){
			
				} else if (e == "falling"){
					//TODO How to stall pipeline?
					//get PC
					this._wInstruction = this._oMemory.load(this._a);
					//read instruction from memory at that address
					
					//Inc address register
					this._a += ARM.WORD_SIZE;
					
					//WRITE PC register
					this._aRegisters[ARM.R_PC] = this._a;
				}
			},
			

			/**
			 * Decode the instruction
			 * 
			 * Set the control signals for the instruction
			 * 
			 * If a STR instruction stall for a cycle
			 * If a LDR instruction stall for 2 cyles
			 * @param p_wInstruction
			 */

			_decode: function (e){
				
				//TODO check the CPSR to see if an exception occured and we need to 
				//set the PC to the value grabbed
				
			if (e=="rising"){
				//reset signal
			//	this._qSignals=[];
				
				//take instruction and cache for next phase
				this._pInstruction = this._wInstruction;
				
				this._pSignals.reverse();
				while (this._pSignals.length > 0){
					this._qSignals.push(this._pSignals.pop())
				
				}
			} else if (e=="falling"){
				//di holds integer of instruction
				var wInstruction = this._pInstruction;
				var op,
					offset8,
					rs,
					rm,
					rn,
					rd;
					
				//var topHalfWord = (wInstruction >>> 8);
				
				//Data-processing: Format 2
				//Add/subtract register
				 if ((wInstruction & 0x1800) ==  0x1800){
					
					rd = wInstruction & 0x0003;
					rn = (wInstruction & 0x0038) >>> 3;
					rm = (wInstruction & 0x01c0) >>> 6;
					op = (wInstruction & 0x0200) >>> 9;
					
					//Set ALU signals
					switch(op){
					case 0x0: //Add
						this._signals.alu.bFn = 0x16;
					break;
					case 0x1: //Sub
						this._signals.alu.bFn = 0x16;
						break;
					default:
					}
					var nop;
					
					//Enable ALU
					this._signals.alu.fEnable = true;
					//Write to destination register
					this._signals.reg.bDataAddress = rd;
					
					this._wABus = this._aRegisters[rn]
					this._wBBus = this._aRegisters[rm]

				} else if
				//Data-processing: Format 3
				//Add/subtract immediate
				(((wInstruction & 0xFFFF) >>> 13) == 0x1){
				//((wInstruction & 0x2000) == 0x2000)	{
					offset8 = wInstruction & 0x00FF;
					rd = (wInstruction & 0x0700) >> 8;
					op = (wInstruction & 0x1800) >> 11;
					
					//Put value directly on b bus
					this._wBBus = offset8;
					//Set alu function
					 
					//Set register to be put on a bus
					//this._signals.reg.bAddressA = rd;
					var aluFn;
					switch(op){
					case 0x2: //Add
						aluFn = 0x16;
					break;
					default:
					}
					
					this._pSignals.push(function(e){
						if (e=="rising"){
							this._signals.alu.bFn = aluFn;
								
							this._signals.alu.fEnable = true;
							//Write result to the same register
							this._signals.reg.bDataAddress = rd;
							//TODO set signals and wait till exe to grab?
							//Put on a bus
							this._wABus = this._aRegisters[rd]
							
							this._signals.reg.fWrite = true;
							
							

						} else if (e="falling"){
							this._signals.reg.fWrite = false;
							//we are done with this callback, remove global instance
							this._qSignals.reverse().pop();
						}
					});
					
				/*} else if
				//Data-processing: Format 4
				//add/sub/comp/move immediate
				(topHalfWord & 0x20 == 0x20){
					
				
				} else if
				//Data-processing: Format 5
				//Shift by immediate
				 (topHalfWord & 0xE0 == 0xE0){
			
					
				} else if 

				//Data-processing register
				(topHalfWorld & 0x4C == 0x40){
					
				} else if 
				//Branch/Exchange
				(topHalfWord == 0x47){
					
				} else if 
				//Special data processing
				(topHalfWord & 0xF){*/
					
				} else if 
				(((wInstruction & 0xFFFF) >>> 13) == 0x3){ //FORMAT 10: Load/Store immediate offset
					rd = wInstruction & 0x0003;
					rn = (wInstruction & 0x0038) >>> 3;
					
					var immed_5 = (wInstruction & 0x07C0) >>> 5;
										
					var B = (wInstruction & 0x1000) >>> 11
					var L = (wInstruction & 0x0800) >>> 10
					
					this._pSignals.push(function(e){
						
						if (e=="rising"){
	
							//Set signals for multiplier
							//TODO switch to booth mul
							this._wABus = immed_5 * 4;
							
							//Set up base register to be put on bus
							this._wBBus = this._aRegisters[rn];
							
							//Store the incremented value of the address register to the PC 
							//this._signals.addr.bOut = 0x1;
							//this._signals.inc.fEnable = true;
							
						} else if (e=="falling"){
							//Enable ALU, set to add
							this._signals.alu.fEnable = true;
							this._signals.alu.bFn = 0x16;
							
							//Store result in address register
							this._signals.addr.fWrite = true;
							this._signals.addr.bSelect = 0x0;
							
							//we are done with this callback, remove global instance
							this._qSignals.reverse().pop();
						}
					})
					
					
					
					if (L==0) { //Store
						this._pSignals.push(function(e){
							if (e=="rising"){
								this._signals.alu.fEnable = false;

								//Write word loaded into register
								this._signals.reg.bDataAddress =rd;
								//this._wBBus = this._aRegisters[rd];

								 this._oMemory.store(this._a, this._aRegisters[rd] );
								 
							} else if (e=="falling"){
								//Store PC back in address register
								this._signals.addr.fWrite =true;
								this._signals.addr.bSelect = 0x1;
								
								//we are done with this callback, remove global instance
								this._qSignals.reverse().pop();
							}
						})
						
					} else  { // Load 

						this._qSignals.push(function(e){
							if (e=="rising"){
								this._signals.alu.fEnable = false;

								//Write word loaded into register
								this._signals.reg.bDataAddress = rd;
								
								this._aRegisters[rd] = this._oMemory.load(this._a);
								
							} else if (e=="falling"){
								this._qSignals.reverse().pop();
							}
						})
						
						
						/*
						 * Tranfer data from data-in register to destination register
						 */
						this._qSignals.push(function(){
							
						})
					}
				} else if 
				//B, BL, BLX
				(((wInstruction & 0xFFFF) >>> 13) == 0x7){
					
					var H = (wInstruction & 0x1800) >>> 11;
					var offset_11 = (wInstruction & 0x07FF);
					var firstBit = (wInstruction & 0x000E);
					
					switch(H){
					case 0x0: //B (2)
						break;
					case 0x1: //BLX suffix
						if (firstBit==0x0){
							
						}
						break;
					case 0x2:
						break;
					case 0x3:
						break;
					}
				} else if 
				((wInstruction & 0xD000) == 0xD000){
					
					var signed_immed_8 = wInstruction & 0x00FF;
					var cond = (wInstruction & 0x0F00) >>> 8;
					switch(cond){
						case 0x0: //Z set
							break;
						case 0x1: //Z clear
							break;
						case 0x2: //C set
							break;
						case 0x3: //C clear
							break;
						case 0x4: //N set
							break;
						case 0x5: //N clear
							break;
						case 0x6: //V set
							break;
						case 0x7: //V clear
							break;
						case 0x8: //C set and Z clear
							break;
						case 0x9: //C set or Z set
							break;
						case 0xA: //N set and V set, or N clear and V clear
							break;
						case 0xB: //N set and V clear, or N clear and V set
							break;
						case 0xC: //Z clear, and either N set and V set, or N clear and V clear
							break;
						case 0xD: //Z set or N set and V clear, or N clear and V set
							break;
						case 0xE: //Always
							break;
						case 0xF: //SWI
							break;
					}
					
				}
				
				
			}
			
			},

			/* COMPONENTS */
			
			/** 
			 * Address Register
			 * 
			 * Pipeline register interface to external memory
			 * 
			 * Input from ALU, Exception Vector, PC register
			 */
			_addrReg: function(e){
				if (this._signals.addr.fWrite){
					switch(this._signals.addr.bSelect){
					case 0x0:
						this._a = this._wALUBus;
						break;
					case 0x1:
						this._a = this._aRegisters[ARM.R_PC];
						break;
					case 0x2:
						this._a = this._wIncBus;
						break;
					default:
					}
				} 
				switch(this._signals.addr.bOut){
					case 0x0:
						//Put address on memory address bus
						this._oMemory.a = this._a;
						break;
					case 0x1:
						//FIXME For now bypass incrementing and store straight in PC
						//this._wIncBus = this._a;
						this._aRegisters[ARM.R_PC]=this._a;

						break;
					default:
						
				}
				
			},
			/**
			 * Register File
			 */
			_regfile: function(e){
				
				if (this._signals.reg.fWrite){
					this._aRegisters[this._signals.reg.bDataAddress] = this._wALUBus;
				}
			},
			_inc: function(e){
				
				if (this._signals.inc.fEnable){
					this._wIncBus += ARM.WORD_SIZE;
				}
				
			},
			_alu: function (e){
				//if (e=="rising"){

				if (this._signals.alu.fEnable) {
					var A = this._wABus,
						B = this._wBBus,
						val = 0;
					/**
					 * fuber p90
					 * ARM2 implementation
					 */
					switch(this._signals.alu.bFn){
						case 0x04: //A AND B
							val = A & b;
							break;
						case 0x08: //A AND NOT B
							val = A & (~B);
							break;
						case 0x09: //A XOR B
							val = A ^ B;
							break;
						case 0x19: //A plus NOT B plus Carry
							val = A + (~B);
							break;
						case 0x16: //A plus B plus Carry
							val = A + B;
							break;
						case 0x26: //not A plus B plus Carry
							val = (~A) + B;
							break;
						case 0x00: //A
							val = A;
							break;
						case 0x01: //A or B
							val = A | B;
							break;
						case 0x05: //B
							val = B;
							break;
						case 0x0A: //not B
							val = ~B;
							break;
						case 0x0C: //zero
							val = 0;
							break;
						default:
		
					}
					this._wALUBus = val;		
				}
				//}
			}
	
			
	}
	koch.ARM = ARM;
	
	var Memory = function(oConfig){
		this._iSize = oConfig.size;
		
		this.init();
	}
	Memory.prototype = {
			_iSize: 0,
			_aMemory: [],
			
			/**
			 * Address bus
			 */
			a: 0x00000000,
			/**
			 * Data Bus
			 */
			d: 0x00000000,
			
			init: function(){
				this._aMemory = new Array(this._iSize);

			},
			/**
			 * Load 16 bit word
			 * 
			 * @param p_bAddress
			 * @returns
			 */
			load: function(p_bAddress){
				var lower = parseInt(document.getElementById("mem-"+p_bAddress.toString(16)).value,16);
				var upper = parseInt(document.getElementById("mem-"+(p_bAddress+8).toString(16)).value,16);
				var val = (upper << 8) | lower;
				return val;
			},
			store: function(p_bAddress, p_bValue){
				//TODO
				//Do you have permission to access this addresss?
				
				//And is the address is memory?
				document.getElementById("mem-"+p_bAddress.toString(16)).value = p_bValue.toString(16);
				var nop;
			}
	
	}
	
	koch.Mem = Memory;
	
})()



